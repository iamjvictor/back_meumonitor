import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeSearchInput } from '../../../../../repositories/knowledge-retrieval.repository.js';
import type { HybridRetrievalResult } from '../../../../../worker/services/hybrid-retrieval.service.js';
import type { ChatRagInput } from '../../models/chat-rag.model.js';
import { KnowledgeRetrievalChatProvider } from '../knowledge-retrieval-chat.provider.js';

function makeInput(): ChatRagInput {
  return {
    message: 'Como resolvo esta questão?',
    history: [],
    questionContext: null,
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
    questionDocumentId: 'document-question-1',
    questionBlockId: 'block-question-1',
  };
}

function makeRetrievalResult(): HybridRetrievalResult {
  return {
    citations: [
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        blockId: 'block-1',
        parentBlockId: null,
        chunkIndex: 3,
        blockType: 'EXPLANATION',
        similarity: 0.91,
        lexicalScore: 0.4,
        fusedScore: 0.7,
        content: 'A força resultante é a soma vetorial das forças.',
        pageStart: 4,
        pageEnd: 4,
        sectionPath: ['Dinâmica'],
        isComplete: true,
        incompleteReason: null,
        reason: null,
      },
    ],
    candidates: [],
    contextBlocks: [],
    metrics: {
      recallAtK: 0,
      precisionAtK: 0,
      reciprocalRank: 0,
      mrr: 0,
      ndcg: 0,
      contextPrecision: 0,
      contextRecall: 0,
      irrelevantEvidenceRate: 0,
    },
  };
}

test('gera um embedding e consulta retrieval com o escopo autorizado', async () => {
  const embeddingInputs: string[][] = [];
  const embeddingOptions: Array<{ timeoutMs?: number }> = [];
  const retrievalInputs: KnowledgeSearchInput[] = [];
  const provider = new KnowledgeRetrievalChatProvider(
    {
      async createEmbeddings(input, options) {
        embeddingInputs.push(input);
        embeddingOptions.push(options ?? {});
        return [[0.1, 0.2, 0.3]];
      },
    },
    {
      async search(input) {
        retrievalInputs.push(input);
        return makeRetrievalResult();
      },
    },
  );

  const result = await provider.retrieve(makeInput());

  assert.equal(embeddingInputs.length, 1);
  assert.equal(embeddingInputs[0]?.length, 1);
  assert.equal(embeddingOptions[0]?.timeoutMs, 2_000);
  assert.equal(retrievalInputs.length, 1);
  assert.equal(retrievalInputs[0]?.teacherId, 'teacher-1');
  assert.equal(retrievalInputs[0]?.monitorId, 'monitor-1');
  assert.equal(retrievalInputs[0]?.subjectId, 'subject-1');
  assert.equal(retrievalInputs[0]?.topicId, 'topic-1');
  assert.equal(retrievalInputs[0]?.questionDocumentId, 'document-question-1');
  assert.equal(retrievalInputs[0]?.questionBlockId, 'block-question-1');
  assert.equal(retrievalInputs[0]?.limit, 8);
  assert.deepEqual(retrievalInputs[0]?.queryEmbedding, [0.1, 0.2, 0.3]);
  assert.equal(result.used, true);
  assert.equal(result.citations[0]?.chunkId, 'chunk-1');
  assert.match(result.context, /força resultante/);
});

test('retorna fallback sem evidências quando o embedding falha', async () => {
  const retrievalCalls: KnowledgeSearchInput[] = [];
  const provider = new KnowledgeRetrievalChatProvider(
    {
      async createEmbeddings() {
        throw new Error('embedding provider unavailable');
      },
    },
    {
      async search(input) {
        retrievalCalls.push(input);
        return makeRetrievalResult();
      },
    },
  );

  const result = await provider.retrieve(makeInput());

  assert.equal(result.used, false);
  assert.equal(result.citations.length, 0);
  assert.equal(result.context, '');
  assert.equal(retrievalCalls.length, 0);
});

test('retorna fallback semântico quando o embedding excede o orçamento', async () => {
  const provider = new KnowledgeRetrievalChatProvider(
    {
      async createEmbeddings() {
        const error = new Error('embedding timeout');
        error.name = 'EMBEDDING_TIMEOUT';
        throw error;
      },
    },
    { async search() { throw new Error('não deveria consultar retrieval'); } },
  );

  const result = await provider.retrieve(makeInput());

  assert.equal(result.used, false);
  assert.equal(result.metrics.selectedCount, 0);
});

test('retorna fallback sem evidências quando o retrieval falha', async () => {
  const provider = new KnowledgeRetrievalChatProvider(
    { async createEmbeddings() { return [[0.1]]; } },
    { async search() { throw new Error('database unavailable'); } },
  );

  const result = await provider.retrieve(makeInput());

  assert.equal(result.used, false);
  assert.equal(result.citations.length, 0);
  assert.equal(result.context, '');
});
