import assert from 'node:assert/strict';
import test from 'node:test';

test('guarda de substituição aborta quando há FlashcardSource existente', async () => {
  const { assertChunkReplacementSafe } = await import('../document-worker.repository.js');
  assert.throws(() => assertChunkReplacementSafe(true), /FlashcardSource.*preservados/);
});

import { prisma } from '../../lib/prisma.js';
import type {
  LayoutDocument,
  ParseRunRecord,
} from '../../worker/services/document-parser/document-parser.types.js';
import { createDocumentParseRun, persistLayoutDocument, PrismaDocumentParseRunStore } from '../document-parser.repository.js';
import { checksumParserArtifact } from '../document-parser.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeLayout(parseRunId: string): LayoutDocument {
  return {
    schemaVersion: 'layout-v1',
    documentId: 'document-1',
    parseRunId,
    parser: {
      name: 'DOCLING',
      version: '2.122.0',
      configurationHash: 'cfg-123',
    },
    pages: [
      {
        pageNumber: 2,
        width: 200,
        height: 100,
        elements: [
          {
            id: 'child-logical-id',
            pageNumber: 2,
            readingOrder: 1,
            category: 'TEXT',
            rawText: 'Conteúdo',
            bbox: {
              x0: 0,
              y0: 0,
              x1: 100,
              y1: 50,
              coordinateSpace: 'NORMALIZED_1000',
            },
            parentElementId: 'parent-logical-id',
            assetIds: ['asset-1'],
          },
          {
            id: 'parent-logical-id',
            pageNumber: 2,
            readingOrder: 0,
            category: 'TITLE',
            rawText: 'Título',
            bbox: {
              x0: 0,
              y0: 0,
              x1: 100,
              y1: 30,
              coordinateSpace: 'NORMALIZED_1000',
            },
            assetIds: [],
          },
        ],
      },
    ],
    assets: [
      {
        id: 'asset-1',
        type: 'FIGURE',
        pageNumber: 2,
        bbox: {
          x0: 0,
          y0: 0,
          x1: 50,
          y1: 50,
          coordinateSpace: 'NORMALIZED_1000',
        },
      },
    ],
    warnings: [],
  };
}

test('salva ou atualiza parse run pela idempotency key sem substituir o ID canônico', { concurrency: false }, async () => {
  const originalUpsert = prisma.documentParseRun.upsert;
  let captured: { where?: unknown; create?: Record<string, unknown>; update?: Record<string, unknown> } = {};

  try {
    (prisma.documentParseRun as typeof prisma.documentParseRun & { upsert: any }).upsert = async (args: typeof captured) => {
      captured = args;
      return {} as never;
    };

    const record: ParseRunRecord = {
      parseRunId: 'parser-retry-id',
      status: 'COMPLETED',
      idempotencyKey: 'document-1:stable-key',
      documentId: 'document-1',
      contentHash: 'hash-1',
      parser: 'MINERU',
      parserVersion: '3.4.5',
      configurationHash: 'cfg-1',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:01:00.000Z',
    };

    await new PrismaDocumentParseRunStore().save(record);

    assert.deepEqual(captured.where, { idempotencyKey: 'document-1:stable-key' });
    assert.equal(captured.create?.id, 'parser-retry-id');
    assert.equal('id' in (captured.update ?? {}), false);
  } finally {
    (prisma.documentParseRun as typeof prisma.documentParseRun & { upsert: any }).upsert = originalUpsert;
  }
});

test('persiste runs distintos sem sobrescrever ids e preserva a ordem dos elementos', async () => {
  const originalTransaction = prisma.$transaction;
  const runs: Array<{
    createdElements: Array<Record<string, unknown>>;
    createdAssets: Array<Record<string, unknown>>;
  }> = [];

  try {
    (prisma as typeof prisma & {
      $transaction: typeof prisma.$transaction;
    }).$transaction = async (handler: any) => {
      const createdElements: Array<Record<string, unknown>> = [];
      const createdAssets: Array<Record<string, unknown>> = [];

      const transaction = {
        documentParseRun: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            documentId: 'document-1',
          }),
        },
        documentLayoutElement: {
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            createdElements.push(...data);
            return { count: data.length };
          },
        },
        documentVisualAsset: {
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            createdAssets.push(...data);
            return { count: data.length };
          },
        },
      };

      const result = await handler(transaction);
      runs.push({ createdElements, createdAssets });
      return result;
    };

    const first = await persistLayoutDocument({
      documentId: 'document-1',
      parseRunId: 'parse-run-1',
      layout: makeLayout('parse-run-1'),
    });
    const second = await persistLayoutDocument({
      documentId: 'document-1',
      parseRunId: 'parse-run-2',
      layout: makeLayout('parse-run-2'),
    });

    assert.equal(first.parseRunId, 'parse-run-1');
    assert.equal(second.parseRunId, 'parse-run-2');
    assert.equal(runs.length, 2);

    const firstRun = runs[0]!;
    const secondRun = runs[1]!;
    assert.equal(firstRun.createdElements.length, 2);
    assert.equal(secondRun.createdElements.length, 2);

    const firstParent = firstRun.createdElements[0]!;
    const firstChild = firstRun.createdElements[1]!;
    const firstAsset = firstRun.createdAssets[0]!;

    assert.equal(firstParent.readingOrder, 0);
    assert.equal(firstChild.readingOrder, 1);
    assert.equal(firstParent.category, 'TITLE');
    assert.equal(firstChild.category, 'TEXT');

    assert.match(String(firstParent.id), UUID_RE);
    assert.match(String(firstChild.id), UUID_RE);
    assert.notEqual(firstParent.id, 'parent-logical-id');
    assert.notEqual(firstChild.id, 'child-logical-id');

    assert.equal(firstParent.documentId, 'document-1');
    assert.equal(firstParent.parseRunId, 'parse-run-1');
    assert.equal(firstChild.documentId, 'document-1');
    assert.equal(firstChild.parseRunId, 'parse-run-1');

    assert.equal(firstChild.parentElementId, firstParent.id);
    assert.equal(firstAsset.layoutElementId, firstChild.id);

    assert.notDeepEqual(
      firstRun.createdElements.map((row) => row.id),
      secondRun.createdElements.map((row) => row.id),
    );
  } finally {
    (prisma as typeof prisma & { $transaction: typeof prisma.$transaction }).$transaction =
      originalTransaction;
  }
});

test('persiste parserBackend e versões do parser ao criar parse run', async () => {
  const originalCreate = prisma.documentParseRun.create;
  let capturedData: Record<string, unknown> | undefined;

  try {
    (prisma as typeof prisma & {
      documentParseRun: { create: any };
    }).documentParseRun.create = async ({ data }: { data: Record<string, unknown> }) => {
      capturedData = data;
      return { id: 'parse-run-1' } as never;
    };

    const record = {
      parseRunId: 'parse-run-1',
      status: 'PROCESSING',
      idempotencyKey: 'document-1:MINERU:3.4.5:pipeline:layout-model-1:cfg-1:layout-v1',
      documentId: 'document-1',
      contentHash: 'content-hash-1',
      parser: 'MINERU',
      parserVersion: '3.4.5',
      configurationHash: 'cfg-1',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
      parserBackend: 'pipeline',
      modelVersion: 'layout-model-1',
      layoutSchemaVersion: 'layout-v1',
    } as ParseRunRecord & {
      parserBackend: string;
      modelVersion: string;
      layoutSchemaVersion: string;
    };

    await createDocumentParseRun({
      record,
      parserVersion: '3.4.5',
      modelVersion: 'layout-model-1',
      layoutSchemaVersion: 'layout-v1',
      contentHash: 'content-hash-1',
    });

    assert.equal(capturedData?.parserBackend, 'pipeline');
    assert.equal(capturedData?.parserVersion, '3.4.5');
    assert.equal(capturedData?.modelVersion, 'layout-model-1');
    assert.equal(capturedData?.layoutSchemaVersion, 'layout-v1');
  } finally {
    (prisma as typeof prisma & {
      documentParseRun: { create: any };
    }).documentParseRun.create = originalCreate;
  }
});

test('calcula checksum SHA-256 do artefato', () => {
  assert.equal(
    checksumParserArtifact('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
