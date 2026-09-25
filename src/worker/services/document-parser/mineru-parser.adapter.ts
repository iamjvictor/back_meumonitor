import {
  DocumentParserAdapterError,
  type DocumentParserAdapter,
} from './document-parser.adapter.js';
import { normalizeLayoutDocument } from './layout-document-normalizer.js';
import type {
  DocumentParserName,
  LayoutDocument,
  ParseInput,
  ParseStatus,
  ParseSubmission,
} from './document-parser.types.js';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

type FetchLike = typeof fetch;

type MineruClientOptions = {
  baseUrl: string;
  submitPath?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  logger?: BoundaryLogger;
};

type BoundaryLogger = (event: string, payload: Record<string, unknown>) => void;

type ParserErrorDetails = {
  errorCode?: string;
  errorMessage?: string;
};

/**
 * HTTP adapter for the isolated parser service.
 *
 * The adapter speaks the MeuMonitorAI parser protocol (`/v1/parse` by
 * default), not MinerU's internal JSON. The Python sidecar is therefore free
 * to change its CLI/API implementation while the worker keeps this contract.
 */
export class MineruParserAdapter implements DocumentParserAdapter {
  readonly name: DocumentParserName = 'DOCLING';

  private readonly baseUrl: string;
  private readonly submitPath: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly logger: BoundaryLogger;
  private readonly inlineResults = new Map<string, LayoutDocument>();
  private readonly inFlightParses = new Map<string, Promise<ParseSubmission>>();

  constructor(options: MineruClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.submitPath = options.submitPath ?? '/v1/parse';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 600_000;
    this.logger = options.logger ?? defaultBoundaryLogger;
  }

  async parse(input: ParseInput): Promise<ParseSubmission> {
    const idempotencyKey = buildIdempotencyKey(input);
    const inFlight = this.inFlightParses.get(idempotencyKey);
    if (inFlight) return inFlight;

    const request = this.parseOnce(input);
    this.inFlightParses.set(idempotencyKey, request);
    try {
      return await request;
    } finally {
      if (this.inFlightParses.get(idempotencyKey) === request) {
        this.inFlightParses.delete(idempotencyKey);
      }
    }
  }

  private async parseOnce(input: ParseInput): Promise<ParseSubmission> {
    const form = input.fileBytes
      ? createMultipartBody(input.fileBytes, input.fileName ?? input.originalName ?? inferFileName(input.fileUrl) ?? 'document.pdf', input.mimeType)
      : createMultipartBody(
        new Uint8Array(await (await this.request(input.fileUrl, { method: 'GET' })).arrayBuffer()),
        input.fileName ?? input.originalName ?? inferFileName(input.fileUrl) ?? 'document.pdf',
        input.mimeType,
      );
    const response = await this.request(this.submitPath, {
      method: 'POST',
      body: form,
    });

    const body = await readJson(response);
    if (isRecord(body) && body.status === 'failed' && isRecord(body.error)) {
      throw new DocumentParserAdapterError(
        typeof body.error.message === 'string' ? body.error.message : 'O parser falhou durante a conversão.',
        typeof body.error.code === 'string' ? body.error.code : 'PARSER_ERROR',
        response.status,
      );
    }
    const inline = normalizeInlineResponse(body, input);
    if (inline) {
      this.inlineResults.set(inline.parseRunId, inline.result!);
      return inline;
    }
    if (!isParseSubmission(body)) {
      throw new DocumentParserAdapterError(
        'Resposta de submissão do parser inválida.',
        'PARSER_INVALID_SUBMISSION',
        response.status,
      );
    }
    return body;
  }

  async getStatus(parseRunId: string, statusUrl?: string): Promise<ParseStatus> {
    const response = await this.request(statusUrl ?? `/v1/parse/${encodeURIComponent(parseRunId)}`, {
      method: 'GET',
    });
    const body = await readJson(response);
    if (!isParseStatus(body)) {
      throw new DocumentParserAdapterError(
        'Resposta de status do parser inválida.',
        'PARSER_INVALID_STATUS',
        response.status,
      );
    }
    return body;
  }

  async getResult(parseRunId: string, resultUrl?: string): Promise<LayoutDocument> {
    const inline = this.inlineResults.get(parseRunId);
    if (inline) return inline;
    const response = await this.request(resultUrl ?? `/v1/parse/${encodeURIComponent(parseRunId)}/result`, {
      method: 'GET',
    });
    const body = await readJson(response);
    try {
      return normalizeLayoutDocument(body);
    } catch (error) {
      throw new DocumentParserAdapterError(
        error instanceof Error ? error.message : 'Resposta de layout do parser inválida.',
        'PARSER_INVALID_LAYOUT_DOCUMENT',
        response.status,
      );
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const method = init.method ?? 'GET';
    const startedAt = Date.now();

    this.logger('docling_client.request_started', {
      method,
      url,
      timeoutMs: this.requestTimeoutMs,
    });

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const { error, upstream } = await buildHttpError(response);
        this.logger('docling_client.request_failed', {
          method,
          url,
          durationMs: Date.now() - startedAt,
          failureKind: 'http',
          statusCode: response.status,
          errorCode: error.code,
          errorMessage: error.message,
          upstreamCode: upstream?.errorCode,
          upstreamMessage: upstream?.errorMessage,
        });
        throw error;
      }
      this.logger('docling_client.request_finished', {
        method,
        url,
        durationMs: Date.now() - startedAt,
        statusCode: response.status,
      });
      return response;
    } catch (error) {
      if (error instanceof DocumentParserAdapterError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new DocumentParserAdapterError('Timeout ao comunicar com o parser.', 'PARSER_TIMEOUT');
        this.logger('docling_client.request_failed', {
          method,
          url,
          durationMs: Date.now() - startedAt,
          failureKind: 'timeout',
          errorCode: timeoutError.code,
          errorMessage: timeoutError.message,
        });
        throw timeoutError;
      }
      const networkError = new DocumentParserAdapterError(
        error instanceof Error ? error.message : 'Falha de comunicação com o parser.',
        'PARSER_NETWORK_ERROR',
      );
      this.logger('docling_client.request_failed', {
        method,
        url,
        durationMs: Date.now() - startedAt,
        failureKind: 'network',
        errorCode: networkError.code,
        errorMessage: networkError.message,
      });
      throw networkError;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const defaultBoundaryLogger: BoundaryLogger = (event, payload) => {
  console.log(event, payload);
};

function createMultipartBody(fileBytes: Uint8Array, fileName: string, mimeType?: string) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(fileBytes)], { type: mimeType ?? 'application/pdf' }), fileName);
  return form;
}

function normalizeInlineResponse(value: unknown, input: ParseInput): ParseSubmission | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  const normalizedStatus = normalizeStatus(value.status);
  if (normalizedStatus !== 'COMPLETED' && normalizedStatus !== 'COMPLETED_WITH_WARNINGS') return null;
  const rawResult = value.result;
  const rawLayout = isRecord(rawResult.layout)
    ? rawResult.layout
    : isLayoutPayload(rawResult)
      ? rawResult
      : null;
  if (!rawLayout) return null;
  const upstreamParseRunId = typeof value.parseRunId === 'string'
    ? value.parseRunId
    : `docling-${typeof value.inputSha256 === 'string' ? value.inputSha256 : input.contentHash}`;
  const parseRunId = toPersistableParseRunId(upstreamParseRunId, input.documentId);
  const layout = normalizeLayoutDocument({
    schemaVersion: typeof rawLayout.schemaVersion === 'string' ? rawLayout.schemaVersion : 'docling-layout-v1',
    documentId: typeof rawLayout.documentId === 'string' ? rawLayout.documentId : input.documentId,
    parseRunId: parseRunId,
    parser: isRecord(rawLayout.parser) && typeof rawLayout.parser.name === 'string' && typeof rawLayout.parser.version === 'string' && typeof rawLayout.parser.configurationHash === 'string'
      ? rawLayout.parser
      : {
        name: input.parser ?? 'DOCLING',
        version: input.parserVersion ?? 'unknown',
        backend: input.backend ?? 'pipeline',
        modelVersion: input.modelVersion,
        configurationHash: input.configurationHash,
      },
    pages: buildInlinePages(rawLayout.pages, input),
    assets: buildInlineAssets(rawLayout.assets, input),
    warnings: Array.isArray(rawLayout.warnings) ? rawLayout.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
  });
  return {
    parseRunId,
    status: layout.warnings.length > 0 || normalizedStatus === 'COMPLETED_WITH_WARNINGS'
      ? 'COMPLETED_WITH_WARNINGS'
      : 'COMPLETED',
    idempotencyKey: typeof value.idempotencyKey === 'string' ? value.idempotencyKey : buildIdempotencyKey(input),
    result: layout,
    statusUrl: typeof value.statusUrl === 'string' ? value.statusUrl : undefined,
    resultUrl: typeof value.resultUrl === 'string' ? value.resultUrl : undefined,
  };
}

function isLayoutPayload(value: Record<string, unknown>): value is Record<string, unknown> & {
  schemaVersion: string;
  pages: unknown[];
  warnings: unknown[];
} {
  return value.schemaVersion === 'docling-layout-v1'
    && Array.isArray(value.pages)
    && Array.isArray(value.warnings);
}

function toPersistableParseRunId(value: string, documentId: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  const hex = createHash('sha256').update(`docling-parse:${documentId}:${value}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

type VersionedIdempotencyInput = Pick<ParseInput, 'documentId' | 'contentHash' | 'configurationHash' | 'parser' | 'backend'> & {
  parserVersion?: string;
  modelVersion?: string;
  schemaVersion?: string;
};

export function buildIdempotencyKey(input: VersionedIdempotencyInput) {
  return [
    input.documentId,
    input.contentHash,
    input.parser ?? 'MINERU',
    input.parserVersion ?? 'unknown-parser-version',
    input.backend ?? 'pipeline',
    input.modelVersion ?? 'unknown-model-version',
    input.configurationHash,
    input.schemaVersion ?? 'unknown-schema-version',
  ].join(':');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DocumentParserAdapterError('Parser retornou JSON inválido.', 'PARSER_INVALID_JSON', response.status);
  }
}

async function buildHttpError(response: Response): Promise<{
  error: DocumentParserAdapterError;
  upstream: ParserErrorDetails | null;
}> {
  const upstream = await tryReadParserError(response);
  const details = [
    `Parser respondeu HTTP ${response.status}.`,
    upstream?.errorCode ? `upstreamCode=${upstream.errorCode}` : null,
    upstream?.errorMessage ? `upstreamMessage=${upstream.errorMessage}` : null,
  ].filter(Boolean).join(' ');
  return {
    error: new DocumentParserAdapterError(details, 'PARSER_HTTP_ERROR', response.status),
    upstream,
  };
}

async function tryReadParserError(response: Response): Promise<ParserErrorDetails | null> {
  try {
    const payload = await response.json();
    if (!isRecord(payload) || !isRecord(payload.error)) return null;
    return {
      errorCode: typeof payload.error.code === 'string' ? payload.error.code : undefined,
      errorMessage: typeof payload.error.message === 'string' ? payload.error.message : undefined,
    };
  } catch {
    return null;
  }
}

function isParseSubmission(value: unknown): value is ParseSubmission {
  if (!isRecord(value)) return false;
  return typeof value.parseRunId === 'string'
    && typeof value.status === 'string'
    && typeof value.idempotencyKey === 'string';
}

function isParseStatus(value: unknown): value is ParseStatus {
  if (!isRecord(value)) return false;
  return typeof value.parseRunId === 'string' && typeof value.status === 'string';
}

function normalizeStatus(value: unknown): ParseSubmission['status'] {
  if (typeof value !== 'string') {
    throw new DocumentParserAdapterError('Parser retornou status inválido.', 'PARSER_INVALID_STATUS');
  }
  switch (value.trim().toUpperCase()) {
    case 'PENDING':
      return 'PENDING';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'NORMALIZING':
      return 'NORMALIZING';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'COMPLETED_WITH_WARNINGS':
      return 'COMPLETED_WITH_WARNINGS';
    case 'FAILED':
      return 'FAILED';
    case 'FALLBACK_REQUIRED':
      return 'FALLBACK_REQUIRED';
    case 'SUPERSEDED':
      return 'SUPERSEDED';
    default:
      throw new DocumentParserAdapterError(`Parser retornou status desconhecido: ${value}.`, 'PARSER_INVALID_STATUS');
  }
}

function buildInlinePages(pages: unknown, input: ParseInput) {
  if (!Array.isArray(pages)) return [];
  return pages.map((page, pageIndex) => {
    const pageRecord = isRecord(page) ? page : {};
    const pageNumber = normalizePageNumber(pageRecord.pageNumber, pageIndex);
    const width = normalizePositiveNumber(pageRecord.width, 1000) ?? 1000;
    const height = normalizePositiveNumber(pageRecord.height, 1000) ?? 1000;
    const elements = Array.isArray(pageRecord.elements) ? pageRecord.elements : [];
    return {
      pageNumber,
      width,
      height,
      elements: elements.map((element, elementIndex) => {
        const elementRecord = isRecord(element) ? element : {};
        const text = typeof elementRecord.text === 'string' ? elementRecord.text : undefined;
        return {
          externalIndex: normalizeNonNegativeInteger(elementRecord.externalIndex, elementIndex),
          level: normalizeIntegerOrUndefined(elementRecord.level),
          type: typeof elementRecord.type === 'string' ? elementRecord.type : 'UNKNOWN',
          text,
          normalizedText: typeof elementRecord.normalizedText === 'string' ? elementRecord.normalizedText : text,
          latex: typeof elementRecord.latex === 'string' ? elementRecord.latex : undefined,
          html: typeof elementRecord.html === 'string' ? elementRecord.html : undefined,
          bbox: normalizeBoundingBoxTuple(elementRecord.bbox) ?? [0, 0, width, height],
          assetIds: Array.isArray(elementRecord.assetIds)
            ? elementRecord.assetIds.filter((assetId): assetId is string => typeof assetId === 'string')
            : [],
          parserMetadata: {
            ...(isRecord(elementRecord.parserMetadata) ? elementRecord.parserMetadata : {}),
            source: 'docling-http',
            inputSha256: input.contentHash,
          },
        };
      }),
    };
  });
}

function buildInlineAssets(assets: unknown, input: ParseInput) {
  if (!Array.isArray(assets)) return [];
  return assets
    .map((asset, assetIndex) => {
      const assetRecord = isRecord(asset) ? asset : {};
      const id = typeof assetRecord.id === 'string' ? assetRecord.id : `${input.documentId}:asset-${assetIndex}`;
      const type = normalizeAssetType(assetRecord.type);
      const pageNumber = normalizePageNumber(assetRecord.pageNumber, 0);
      return {
        id,
        type,
        pageNumber,
        storagePath: typeof assetRecord.storagePath === 'string' ? assetRecord.storagePath : undefined,
        mimeType: typeof assetRecord.mimeType === 'string' ? assetRecord.mimeType : undefined,
        width: normalizePositiveNumber(assetRecord.width, undefined),
        height: normalizePositiveNumber(assetRecord.height, undefined),
        bbox: normalizeBoundingBoxTuple(assetRecord.bbox) ?? undefined,
        checksum: typeof assetRecord.checksum === 'string' ? assetRecord.checksum : undefined,
        metadata: isRecord(assetRecord.metadata) ? assetRecord.metadata : undefined,
      };
    });
}

function normalizePageNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback + 1;
}

function normalizePositiveNumber(value: unknown, fallback?: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeIntegerOrUndefined(value: unknown) {
  return Number.isInteger(value) ? value : undefined;
}

function normalizeBoundingBoxTuple(value: unknown): [number, number, number, number] | null {
  if (Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return value as [number, number, number, number];
  }
  if (isRecord(value)) {
    const left = extractBoundingBoxCoordinate(value, 'x0', 'l');
    const top = extractBoundingBoxCoordinate(value, 'y0', 't');
    const right = extractBoundingBoxCoordinate(value, 'x1', 'r');
    const bottom = extractBoundingBoxCoordinate(value, 'y1', 'b');
    if ([left, top, right, bottom].every((coordinate) => typeof coordinate === 'number')) {
      return [left as number, top as number, right as number, bottom as number];
    }
  }
  return null;
}

function extractBoundingBoxCoordinate(value: Record<string, unknown>, primary: string, secondary: string) {
  const primaryValue = value[primary];
  if (typeof primaryValue === 'number' && Number.isFinite(primaryValue)) return primaryValue;
  const secondaryValue = value[secondary];
  if (typeof secondaryValue === 'number' && Number.isFinite(secondaryValue)) return secondaryValue;
  return null;
}

function normalizeAssetType(value: unknown) {
  if (typeof value !== 'string') return 'FIGURE' as const;
  switch (value.trim().toUpperCase()) {
    case 'TABLE':
      return 'TABLE' as const;
    case 'FORMULA':
      return 'FORMULA' as const;
    case 'CROP':
      return 'CROP' as const;
    case 'LAYOUT_DEBUG':
      return 'LAYOUT_DEBUG' as const;
    default:
      return 'FIGURE' as const;
  }
}

function inferFileName(fileUrl: string) {
  try {
    const url = new URL(fileUrl);
    const pathname = url.pathname.split('/').filter(Boolean).pop();
    return pathname && pathname.includes('.') ? pathname : undefined;
  } catch {
    return undefined;
  }
}

export function assertLayoutDocument(value: unknown): LayoutDocument {
  if (!isRecord(value)) throw new Error('LayoutDocument não é um objeto.');
  if (typeof value.schemaVersion !== 'string' || typeof value.documentId !== 'string' || typeof value.parseRunId !== 'string') {
    throw new Error('LayoutDocument não possui schemaVersion, documentId ou parseRunId válidos.');
  }
  if (!isRecord(value.parser) || !isParserName(value.parser.name) || typeof value.parser.version !== 'string' || typeof value.parser.configurationHash !== 'string') {
    throw new Error('LayoutDocument.parser inválido.');
  }
  if (!Array.isArray(value.pages) || !Array.isArray(value.assets) || !Array.isArray(value.warnings)) {
    throw new Error('LayoutDocument deve conter pages, assets e warnings como arrays.');
  }
  for (const [index, page] of value.pages.entries()) {
    if (!isRecord(page) || !Number.isInteger(page.pageNumber) || !Number.isFinite(page.width) || !Number.isFinite(page.height) || !Array.isArray(page.elements)) {
      throw new Error(`LayoutDocument.pages[${index}] inválida.`);
    }
    for (const [elementIndex, element] of page.elements.entries()) {
      if (!isRecord(element) || typeof element.id !== 'string' || !Number.isInteger(element.pageNumber) || !Number.isInteger(element.readingOrder) || typeof element.category !== 'string' || !isRecord(element.bbox) || !Array.isArray(element.assetIds)) {
        throw new Error(`LayoutDocument.pages[${index}].elements[${elementIndex}] inválido.`);
      }
    }
  }
  return value as unknown as LayoutDocument;
}

function isParserName(value: unknown): value is DocumentParserName {
  return value === 'PDFJS' || value === 'MINERU' || value === 'PADDLE' || value === 'DOCLING';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
