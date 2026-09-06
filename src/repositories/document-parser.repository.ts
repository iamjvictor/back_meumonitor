import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type {
  DocumentParseStatus,
  LayoutDocument,
  ParseRunRecord,
  ParseRunStore,
} from '../worker/services/document-parser/document-parser.types.js';

export const DOCUMENT_PARSER_ARTIFACT_BUCKET = 'document-parser-artifacts';

export type ParserArtifact = {
  path: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  cacheControl?: string;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function buildParserArtifactPath(documentId: string, parseRunId: string, filename: string) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${documentId}/${parseRunId}/${safeFilename}`;
}

export async function createDocumentParseRun(input: {
  record: ParseRunRecord;
  parserVersion?: string;
  modelVersion?: string;
  layoutSchemaVersion: string;
  contentHash: string;
}) {
  return prisma.documentParseRun.create({
    data: {
      id: input.record.parseRunId,
      documentId: input.record.documentId,
      parserName: input.record.parser,
      parserVersion: input.record.parserVersion ?? input.parserVersion,
      parserBackend: input.record.parserBackend,
      modelVersion: input.record.modelVersion ?? input.modelVersion,
      configurationHash: input.record.configurationHash,
      contentHash: input.contentHash,
      layoutSchemaVersion: input.record.layoutSchemaVersion ?? input.layoutSchemaVersion,
      idempotencyKey: input.record.idempotencyKey,
      status: input.record.status,
      createdAt: new Date(input.record.createdAt),
      updatedAt: new Date(input.record.updatedAt),
    },
  });
}

export class PrismaDocumentParseRunStore implements ParseRunStore {
  async findByIdempotencyKey(key: string) {
    const row = await prisma.documentParseRun.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? mapDocumentParseRun(row) : null;
  }

  async findById(parseRunId: string) {
    const row = await prisma.documentParseRun.findUnique({
      where: { id: parseRunId },
    });
    return row ? mapDocumentParseRun(row) : null;
  }

  async save(record: ParseRunRecord) {
    await prisma.documentParseRun.upsert({
      where: { idempotencyKey: record.idempotencyKey },
      create: toDocumentParseRunCreateInput(record),
      update: toDocumentParseRunUpdateInput(record),
    });
  }

  async update(parseRunId: string, patch: Partial<ParseRunRecord>) {
    const row = await prisma.documentParseRun.update({
      where: { id: parseRunId },
      data: toDocumentParseRunPatch(patch),
    });
    return mapDocumentParseRun(row);
  }
}

export async function updateDocumentParseRun(input: {
  parseRunId: string;
  status?: DocumentParseStatus;
  statusUrl?: string;
  resultUrl?: string;
  qualityScore?: number | null;
  artifactManifestPath?: string | null;
  rawOutputPath?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metrics?: Prisma.InputJsonValue | null;
}) {
  // statusUrl/resultUrl are intentionally not persisted in the first schema;
  // they remain transport metadata in the adapter/store until Phase 4.
  void input.statusUrl;
  void input.resultUrl;
  return prisma.documentParseRun.update({
    where: { id: input.parseRunId },
    data: {
      status: input.status,
      qualityScore: input.qualityScore,
      artifactManifestPath: input.artifactManifestPath,
      rawOutputPath: input.rawOutputPath,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      metrics: input.metrics === null ? Prisma.JsonNull : input.metrics,
    },
  });
}

export async function persistLayoutDocument(input: {
  documentId: string;
  parseRunId: string;
  layout: LayoutDocument;
}) {
  if (input.layout.documentId !== input.documentId || input.layout.parseRunId !== input.parseRunId) {
    throw new Error('LayoutDocument não corresponde ao documento ou parse run informado.');
  }

  const { elements, assets } = buildPersistedLayoutRows(input.layout);

  return prisma.$transaction(async (transaction) => {
    const parseRun = await transaction.documentParseRun.findUnique({
      where: { id: input.parseRunId },
      select: { id: true, documentId: true },
    });
    if (!parseRun || parseRun.documentId !== input.documentId) {
      throw new Error('Parse run não encontrado ou pertence a outro documento.');
    }

    if (elements.length > 0) {
      await transaction.documentLayoutElement.createMany({
        data: elements.map((element) => ({
          id: element.id,
          documentId: input.documentId,
          parseRunId: input.parseRunId,
          externalId: element.sourceId,
          pageNumber: element.pageNumber,
          readingOrder: element.readingOrder,
          category: element.category,
          rawText: element.rawText,
          normalizedText: element.normalizedText,
          latex: element.latex,
          html: element.html,
          bbox: asJson(element.bbox),
          columnIndex: element.columnIndex,
          confidence: element.confidence,
          parentElementId: element.parentElementId,
          assetIds: asJson(element.assetIds),
          parserMetadata: element.parserMetadata ? asJson(element.parserMetadata) : undefined,
        })),
        skipDuplicates: true,
      });
    }

    if (assets.length > 0) {
      await transaction.documentVisualAsset.createMany({
        data: assets.map((asset) => ({
          id: asset.id,
          documentId: input.documentId,
          parseRunId: input.parseRunId,
          layoutElementId: asset.layoutElementId,
          pageNumber: asset.pageNumber,
          assetType: asset.assetType,
          storagePath: asset.storagePath ?? buildParserArtifactPath(input.documentId, input.parseRunId, `${asset.id}.bin`),
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          bbox: asset.bbox ? asJson(asset.bbox) : undefined,
          checksum: asset.checksum,
          metadata: asset.metadata ? asJson(asset.metadata) : undefined,
        })),
        skipDuplicates: true,
      });
    }

    return { parseRunId: input.parseRunId, elementCount: elements.length, assetCount: assets.length };
  }, { maxWait: 10_000, timeout: 30_000 });
}

function buildPersistedLayoutRows(layout: LayoutDocument) {
  const orderedElements = layout.pages
    .flatMap((page, pageIndex) => page.elements.map((element, elementIndex) => ({
      pageNumber: page.pageNumber,
      pageIndex,
      elementIndex,
      element,
    })))
    .sort((left, right) => (
      left.pageNumber - right.pageNumber
      || left.element.readingOrder - right.element.readingOrder
      || left.pageIndex - right.pageIndex
      || left.elementIndex - right.elementIndex
    ));

  const elementIdBySourceId = new Map<string, string>();
  for (const entry of orderedElements) {
    const persistentId = randomUUID();
    elementIdBySourceId.set(entry.element.id, persistentId);
  }

  const assetIdBySourceId = new Map<string, string>();
  const firstElementByAssetId = new Map<string, string>();
  for (const entry of orderedElements) {
    for (const assetId of entry.element.assetIds) {
      if (!firstElementByAssetId.has(assetId)) {
        const persistentElementId = elementIdBySourceId.get(entry.element.id);
        if (!persistentElementId) {
          throw new Error(`Elemento não encontrado para asset referenciado: ${assetId}.`);
        }
        firstElementByAssetId.set(assetId, persistentElementId);
      }
    }
  }

  const assets = layout.assets.map((asset) => {
    const persistentAssetId = randomUUID();
    assetIdBySourceId.set(asset.id, persistentAssetId);
    return {
      id: persistentAssetId,
      sourceId: asset.id,
      pageNumber: asset.pageNumber,
      assetType: asset.type,
      storagePath: asset.storagePath,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      bbox: asset.bbox ? asJson(asset.bbox) : undefined,
      checksum: asset.checksum,
      metadata: asset.metadata ? asJson(asset.metadata) : undefined,
      layoutElementId: firstElementByAssetId.get(asset.id),
    };
  });

  const elements = orderedElements.map(({ element }) => {
    const persistentElementId = elementIdBySourceId.get(element.id);
    if (!persistentElementId) {
      throw new Error(`Elemento não encontrado para persistência: ${element.id}.`);
    }

    return {
      id: persistentElementId,
      sourceId: element.id,
      pageNumber: element.pageNumber,
      readingOrder: element.readingOrder,
      category: element.category,
      rawText: element.rawText,
      normalizedText: element.normalizedText,
      latex: element.latex,
      html: element.html,
      bbox: asJson(element.bbox),
      columnIndex: element.columnIndex,
      confidence: element.confidence,
      parentElementId: element.parentElementId
        ? elementIdBySourceId.get(element.parentElementId) ?? null
        : null,
      assetIds: asJson(element.assetIds.map((assetId) => {
        const persistentAssetId = assetIdBySourceId.get(assetId);
        if (!persistentAssetId) {
          throw new Error(`Asset não encontrado para persistência: ${assetId}.`);
        }
        return persistentAssetId;
      })),
      parserMetadata: element.parserMetadata ? asJson(element.parserMetadata) : undefined,
    };
  });

  return { elements, assets };
}

export async function uploadParserArtifact(documentId: string, parseRunId: string, artifact: ParserArtifact) {
  const path = buildParserArtifactPath(documentId, parseRunId, artifact.path);
  const { error } = await supabaseAdmin.storage
    .from(DOCUMENT_PARSER_ARTIFACT_BUCKET)
    .upload(path, artifact.body, {
      contentType: artifact.contentType,
      cacheControl: artifact.cacheControl ?? '3600',
      upsert: true,
    });
  if (error) throw new Error(`Falha ao salvar artefato do parser: ${error.message}`);
  return path;
}

export async function uploadParserJson(
  documentId: string,
  parseRunId: string,
  filename: string,
  value: unknown,
) {
  const body = JSON.stringify(value, null, 2);
  return uploadParserArtifact(documentId, parseRunId, {
    path: filename,
    body,
    contentType: 'application/json',
  });
}

export function checksumParserArtifact(body: Buffer | Uint8Array | string) {
  return createHash('sha256').update(body).digest('hex');
}

type DocumentParseRunRow = Awaited<ReturnType<typeof prisma.documentParseRun.findUnique>>;

function mapDocumentParseRun(row: NonNullable<DocumentParseRunRow>): ParseRunRecord {
  return {
    parseRunId: row.id,
    status: row.status as ParseRunRecord['status'],
    statusUrl: undefined,
    resultUrl: undefined,
    idempotencyKey: row.idempotencyKey,
    documentId: row.documentId,
    contentHash: row.contentHash,
    parser: row.parserName as ParseRunRecord['parser'],
    parserBackend: row.parserBackend ?? undefined,
    parserVersion: row.parserVersion ?? undefined,
    modelVersion: row.modelVersion ?? undefined,
    layoutSchemaVersion: row.layoutSchemaVersion ?? undefined,
    configurationHash: row.configurationHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  };
}

function toDocumentParseRunCreateInput(record: ParseRunRecord) {
  return {
    id: record.parseRunId,
    documentId: record.documentId,
    parserName: record.parser,
    parserVersion: record.parserVersion ?? null,
    parserBackend: record.parserBackend ?? null,
    modelVersion: record.modelVersion ?? null,
    configurationHash: record.configurationHash,
    contentHash: record.contentHash,
    layoutSchemaVersion: record.layoutSchemaVersion ?? 'layout-v1',
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
  };
}

function toDocumentParseRunUpdateInput(record: ParseRunRecord) {
  return {
    documentId: record.documentId,
    parserName: record.parser,
    parserVersion: record.parserVersion ?? null,
    parserBackend: record.parserBackend ?? null,
    modelVersion: record.modelVersion ?? null,
    configurationHash: record.configurationHash,
    contentHash: record.contentHash,
    layoutSchemaVersion: record.layoutSchemaVersion ?? 'layout-v1',
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    updatedAt: new Date(record.updatedAt),
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
  };
}

function toDocumentParseRunPatch(patch: Partial<ParseRunRecord>) {
  return {
    status: patch.status,
    parserVersion: patch.parserVersion,
    parserBackend: patch.parserBackend,
    modelVersion: patch.modelVersion,
    configurationHash: patch.configurationHash,
    contentHash: patch.contentHash,
    layoutSchemaVersion: patch.layoutSchemaVersion,
    idempotencyKey: patch.idempotencyKey,
    updatedAt: new Date(),
  };
}
