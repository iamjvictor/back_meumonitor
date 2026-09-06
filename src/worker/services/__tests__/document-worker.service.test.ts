import assert from 'node:assert/strict';
import test from 'node:test';

function setBackendEnv() {
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3000';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.OPENROUTER_EMBEDDING_MODEL = 'openrouter/test-embedding';
  process.env.OPENROUTER_QUESTION_MODEL = 'openrouter/test-chat';
}

test('FLASHCARDS executa o job de geração após os embeddings e mantém questões em skip', async (t) => {
  setBackendEnv();
  const jobs: Array<{ action: 'start' | 'complete' | 'skip'; operation: string; summary?: unknown; status?: string }> = [];
  let flashcardCalls = 0;
  let questionCalls = 0;
  const order: string[] = [];

  await t.mock.module('../../../repositories/document-worker.repository.js', {
    namedExports: {
      async findDocumentForProcessing() {
        return {
          id: 'document-1', storagePath: 'documents/document-1.pdf', originalName: 'flashcards.pdf',
          mimeType: 'application/pdf', sizeBytes: 42, tag: 'FLASHCARDS', monitorId: 'monitor-1',
          subjectId: 'subject-1', topicId: 'topic-1', topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async markDocumentProcessing() {},
      async markDocumentPartialSuccess() {},
      async markDocumentReady() {},
      async markDocumentFailed() {},
      async markDocumentNeedsOcr() {},
      async findChunkForFlashcardGeneration() { return null; },
      async findFlashcardGenerationChunkIds() { return []; },
    },
  });
  await t.mock.module('../../../repositories/document-processing-job.repository.js', {
    namedExports: {
      DOCUMENT_PROCESSING_VERSION: 4,
      async ensureDocumentProcessingJobs() {},
      async startDocumentProcessingJob(_documentId: string, operation: string) {
        jobs.push({ action: 'start', operation });
      },
      async completeDocumentProcessingJob(_documentId: string, operation: string, summary?: unknown, status?: string) {
        jobs.push({ action: 'complete', operation, summary, status });
      },
      async failDocumentProcessingJob() {},
      async skipDocumentProcessingJob(_documentId: string, operation: string, summary?: unknown) {
        jobs.push({ action: 'skip', operation, summary });
      },
    },
  });
  await t.mock.module('../../../lib/supabase.js', {
    namedExports: {
      supabaseAdmin: {
        storage: {
          from() {
            return {
              async download() {
                return { data: new Blob(['pdf']), error: null };
              },
            };
          },
        },
      },
    },
  });
  await t.mock.module('../pdf-layout-extraction.service.js', {
    namedExports: {
      async extractPdfPagesWithLayout() {
        return [{ num: 1, text: 'Conteúdo conceitual para gerar flashcards.', hasImages: false, imageCount: 0 }];
      },
    },
  });
  await t.mock.module('../processing-time-report.service.js', {
    namedExports: {
      async appendProcessingTimeReport() {},
      formatDuration() { return '0s'; },
    },
  });
  await t.mock.module('../chunk.service.js', { namedExports: { ChunkService: class {} } });
  await t.mock.module('../document-text-extraction.service.js', { namedExports: { DocumentTextExtractionService: class {} } });
  await t.mock.module('../document-block-detection.service.js', { namedExports: { DocumentBlockDetectionService: class {} } });
  await t.mock.module('../embedding.service.js', { namedExports: { EmbeddingService: class {} } });
  await t.mock.module('../question-extraction.service.js', { namedExports: { QuestionExtractionService: class {} } });
  await t.mock.module('../topic-profile-generation.service.js', { namedExports: { TopicProfileGenerationService: class {} } });

  const { DocumentWorkerService } = await import('../document-worker.service.js');
  const worker = new DocumentWorkerService(
    { async processDocument() { return { chunkCount: 1 }; } } as never,
    { async process() { return { quality: 'GOOD', documentTextId: 'text-1' }; } } as never,
    { async process() { return { blockCount: 1, typeCounts: { THEORY: 1 } }; } } as never,
    { async processDocument() { order.push('embeddings'); return { chunkCount: 1, batchCount: 1 }; } } as never,
    { async processDocument() { questionCalls += 1; return { questionCount: 0 }; } } as never,
    { async processTopic() {}, async processSubject() {} } as never,
    {
      documentIngestionV3Service: {
        async processDocument() {
          return { parseRunId: 'parse-1', status: 'COMPLETED', layoutPersisted: true };
        },
      },
      flashcardGenerationService: {
        async processDocument() {
          order.push('flashcards');
          flashcardCalls += 1;
          return { generated: 3, accepted: 2, persisted: 2, rejected: 1, duplicates: 0, rejectedReasons: { UNGROUNDED_EVIDENCE: 1 }, failedChunks: 1, status: 'PARTIAL_SUCCESS', failedChunksDetail: [{ chunkId: 'chunk-1', code: 'PROVIDER_ERROR', raw: 'secret' }] };
        },
      },
    } as never,
  );

  await worker.process('document-1');

  assert.equal(flashcardCalls, 1);
  assert.deepEqual(order, ['embeddings', 'flashcards']);
  assert.equal(questionCalls, 0);
  const flashcardJob = jobs.filter((job) => job.operation === 'GENERATE_FLASHCARD_CANDIDATES');
  assert.deepEqual(flashcardJob.map((job) => job.action), ['start', 'complete']);
  const summary = flashcardJob[1]?.summary as Record<string, unknown>;
  assert.equal(typeof summary.durationMs, 'number');
  assert.equal(summary.status, 'PARTIAL_SUCCESS');
  assert.equal(summary.generated, 3);
  assert.equal(summary.accepted, 2);
  assert.equal(summary.persisted, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.duplicates, 0);
  assert.deepEqual(summary.rejectedReasons, { UNGROUNDED_EVIDENCE: 1 });
  assert.equal(summary.failedChunks, 1);
  assert.deepEqual(summary.failedChunksDetail, [{ chunkId: 'chunk-1', code: 'PROVIDER_ERROR' }]);
  assert.equal(flashcardJob[1]?.status, 'PARTIAL_SUCCESS');
});

test('worker status and resumo de flashcards rejeitam FAILED e payloads sensíveis', async () => {
  const { resolveTrackedOperationStatus, sanitizeFlashcardOutputSummary } = await import('../document-worker.service.js');
  assert.equal(resolveTrackedOperationStatus({ status: 'FAILED' }), 'FAILED');
  assert.equal(resolveTrackedOperationStatus({ status: 'PARTIAL_SUCCESS' }), 'PARTIAL_SUCCESS');
  const summary = sanitizeFlashcardOutputSummary({ status: 'FAILED', accepted: 2, duplicates: 1, rejectedReasons: { UNGROUNDED_EVIDENCE: 2, INVALID_SCHEMA: 'bad', secret: 99 }, failedChunksDetail: [{ chunkId: 'c', code: 'X', response: 'secret' }], content: 'secret' });
  assert.equal(summary.status, 'READY');
  assert.deepEqual(summary.failedChunksDetail, [{ chunkId: 'c', code: 'X' }]);
  assert.equal(summary.accepted, 2);
  assert.equal(summary.duplicates, 1);
  assert.deepEqual(summary.rejectedReasons, { UNGROUNDED_EVIDENCE: 2 });
  assert.equal('content' in summary, false);
});

test('falhas de processamento alteram o status final do documento', async () => {
  const { resolveDocumentStatus, shouldGenerateFlashcardsAfterEmbeddings } = await import('../document-worker.service.js');

  assert.equal(resolveDocumentStatus([]), 'READY');
  assert.equal(resolveDocumentStatus([{ operation: 'GENERATE_CHUNK_EMBEDDINGS', error: new Error('falha') }]), 'PARTIAL_SUCCESS');
  assert.equal(shouldGenerateFlashcardsAfterEmbeddings('FLASHCARDS', false, 10), false);
  assert.equal(shouldGenerateFlashcardsAfterEmbeddings('FLASHCARDS', true, 0), false);
  assert.equal(shouldGenerateFlashcardsAfterEmbeddings('FLASHCARDS', true, 1), true);
  assert.equal(shouldGenerateFlashcardsAfterEmbeddings('KNOWLEDGE_BASE', true, 1), false);
});

test('documentos com tag questions usam o pipeline de conhecimento', async () => {
  const { shouldProcessDocumentContent } = await import('../document-worker.service.js');

  assert.equal(shouldProcessDocumentContent('KNOWLEDGE_BASE'), true);
  assert.equal(shouldProcessDocumentContent('QUESTIONS'), true);
  assert.equal(shouldProcessDocumentContent('FLASHCARDS'), true);
});
