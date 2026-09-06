import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.DATABASE_URL ??= 'postgresql://postgres:password@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.OPENROUTER_EMBEDDING_MODEL ??= 'openrouter/test-embedding';
process.env.OPENROUTER_QUESTION_MODEL ??= 'openrouter/test-chat';

let prisma: any;
let saveExtractedChunks: any;

async function loadRepository() {
  ({ prisma } = await import('../../lib/prisma.js'));
  ({ saveExtractedChunks } = await import('../document-worker.repository.js'));
}

function chunk(blockId: string) {
  return {
    blockId,
    chunkIndexInBlock: 0,
    content: `Conteúdo do ${blockId}`,
    embeddingContent: null,
    tokenCount: 3,
    charStart: 0,
    charEnd: 20,
    pageStart: 1,
    pageEnd: 1,
    status: 'EMBEDDING_PENDING' as const,
  };
}

async function withPersistenceMocks({
  documentTopicIds,
  blocks,
}: {
  documentTopicIds: string[];
  blocks: Array<{ id: string; topicLinks: Array<{ topicId: string | null }> }>;
}, run: (topicRows: Array<Record<string, unknown>>) => Promise<void>) {
  await loadRepository();
  const originalDocumentFindUnique = prisma.monitorDocument.findUnique;
  const originalBlockFindMany = prisma.documentBlock.findMany;
  const originalTransaction = prisma.$transaction;
  const topicRows: Array<Record<string, unknown>> = [];

  (prisma.monitorDocument as { findUnique: typeof prisma.monitorDocument.findUnique }).findUnique =
    (async () => ({
      id: 'document-1',
      teacherId: 'teacher-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
      topicLinks: documentTopicIds.map((topicId) => ({ topicId })),
    })) as typeof prisma.monitorDocument.findUnique;
  (prisma.documentBlock as { findMany: typeof prisma.documentBlock.findMany }).findMany =
    (async () => blocks) as typeof prisma.documentBlock.findMany;
  (prisma as { $transaction: typeof prisma.$transaction }).$transaction = (async (callback: any) =>
    callback({
      $executeRaw: async () => undefined,
      flashcardSource: { findFirst: async () => null },
      documentChunk: {
        deleteMany: async () => undefined,
        createMany: async () => undefined,
      },
      documentChunkTopic: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          topicRows.push(...data);
        },
      },
    })) as typeof prisma.$transaction;

  try {
    await run(topicRows);
  } finally {
    (prisma.monitorDocument as { findUnique: typeof prisma.monitorDocument.findUnique }).findUnique =
      originalDocumentFindUnique;
    (prisma.documentBlock as { findMany: typeof prisma.documentBlock.findMany }).findMany =
      originalBlockFindMany;
    (prisma as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }
}

test('herda tópicos do documento quando o bloco não tem classificação e preserva prioridade do bloco', { concurrency: false }, async () => {
  await withPersistenceMocks({
    documentTopicIds: ['topic-document'],
    blocks: [
      { id: 'block-classified', topicLinks: [{ topicId: 'topic-block' }] },
      { id: 'block-without-classification', topicLinks: [] },
    ],
  }, async (topicRows) => {
    const result = await saveExtractedChunks('document-1', [
      chunk('block-classified'),
      chunk('block-without-classification'),
    ]);

    assert.deepEqual(topicRows.map((row) => row.topicId), ['topic-block', 'topic-document']);
    assert.equal(result.topicCount, 2);
    assert.equal(result.topicLinkCount, 2);
  });
});

test('não cria vínculos quando nem documento nem bloco têm tópicos', { concurrency: false }, async () => {
  await withPersistenceMocks({
    documentTopicIds: [],
    blocks: [{ id: 'block-without-topics', topicLinks: [] }],
  }, async (topicRows) => {
    const result = await saveExtractedChunks('document-1', [chunk('block-without-topics')]);

    assert.deepEqual(topicRows, []);
    assert.equal(result.topicCount, 0);
    assert.equal(result.topicLinkCount, 0);
  });
});
