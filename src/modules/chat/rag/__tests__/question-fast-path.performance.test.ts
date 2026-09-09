import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import type { ChatKnowledgePort } from '../ports/chat-knowledge.port.js';
import type { ChatRagInput } from '../models/chat-rag.model.js';
import type { FlashcardEvidenceResult } from '../models/flashcard-evidence.model.js';
import type { QuestionEvidenceResult } from '../models/question-evidence.model.js';
import { KnowledgeRetrievalChatProvider } from '../providers/knowledge-retrieval-chat.provider.js';
import { ChatQueryBuilder } from '../services/chat-query.builder.js';
import { ChatRagService } from '../services/chat-rag.service.js';

const questionEvidence: QuestionEvidenceResult = {
  strategy: 'DIRECT_QUESTION_SOURCE',
  sufficient: true,
  questionId: 'question-1',
  answer: 'C',
  explanation: 'A explicação oficial da questão.',
  citations: [],
  context: '',
  metrics: { sourceCount: 1, chunkCount: 0, answerKeyCount: 1, explanationCount: 0, durationMs: 1 },
};

const flashcardEvidence: FlashcardEvidenceResult = {
  strategy: 'DIRECT_FLASHCARD_SOURCE',
  sufficient: true,
  flashcardId: 'flashcard-1',
  front: 'O que é força?',
  back: 'É uma interação capaz de alterar o movimento.',
  topicId: 'topic-1',
  citations: [],
  context: '',
  metrics: { sourceCount: 0, chunkCount: 0, durationMs: 1 },
};

function makeInput(overrides: Partial<ChatRagInput> = {}): ChatRagInput {
  return {
    message: 'Pode explicar esta dúvida?',
    history: [],
    questionContext: null,
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
    ...overrides,
  };
}

function emptyKnowledge(): ChatKnowledgePort {
  return {
    async retrieve() {
      throw new Error('retrieval semântico não deveria ser chamado no caminho direto');
    },
  };
}

test('caminho direto de questão permanece abaixo de 1 segundo e ignora retrieval semântico', async () => {
  const startedAt = performance.now();
  const result = await new ChatRagService(emptyKnowledge()).enrich(makeInput({ questionEvidence }));
  const durationMs = performance.now() - startedAt;

  console.log('[question-fast-path.performance.test.ts] benchmark', {
    path: 'DIRECT_QUESTION_SOURCE',
    durationMs: Math.round(durationMs * 100) / 100,
    previousObservedMs: 8_100,
    improvementMs: Math.max(0, 8_100 - durationMs),
  });
  assert.equal(result.result.used, true);
  assert.ok(durationMs < 1_000);
});

test('caminho direto de flashcard permanece abaixo de 1 segundo e ignora embedding', async () => {
  const startedAt = performance.now();
  const result = await new ChatRagService(emptyKnowledge()).enrich(makeInput({ flashcardEvidence }));
  const durationMs = performance.now() - startedAt;

  console.log('[question-fast-path.performance.test.ts] benchmark', {
    path: 'DIRECT_FLASHCARD_SOURCE',
    durationMs: Math.round(durationMs * 100) / 100,
    previousObservedMs: 8_100,
    improvementMs: Math.max(0, 8_100 - durationMs),
  });
  assert.equal(result.result.used, true);
  assert.match(result.context, /O que é força/);
  assert.ok(durationMs < 1_000);
});

test('retrieval semântico com doubles permanece dentro do orçamento de 4 segundos', async () => {
  const provider = new KnowledgeRetrievalChatProvider(
    { async createEmbeddings() { return [[0.1, 0.2]]; } },
    {
      async search() {
        return {
          candidates: [],
          citations: [],
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
      },
    },
  );
  const startedAt = performance.now();
  await provider.retrieve(makeInput());
  const durationMs = performance.now() - startedAt;

  console.log('[question-fast-path.performance.test.ts] benchmark', {
    path: 'SEMANTIC_RETRIEVAL_DOUBLES',
    durationMs: Math.round(durationMs * 100) / 100,
    budgetMs: 4_000,
  });
  assert.ok(durationMs < 4_000);
});

test('mensagem sem anexo monta consulta curta com e sem histórico', () => {
  const builder = new ChatQueryBuilder();
  const withoutHistoryStartedAt = performance.now();
  const withoutHistory = builder.build(makeInput());
  const withoutHistoryDurationMs = performance.now() - withoutHistoryStartedAt;
  const withHistoryStartedAt = performance.now();
  const withHistory = builder.build(makeInput({
    history: [
      { id: '1', role: 'student', content: 'Eu tentei resolver assim.', createdAt: new Date().toISOString() },
      { id: '2', role: 'assistant', content: 'Vamos verificar o conceito.', createdAt: new Date().toISOString() },
    ],
  }));
  const withHistoryDurationMs = performance.now() - withHistoryStartedAt;

  console.log('[question-fast-path.performance.test.ts] benchmark', {
    path: 'MESSAGE_WITHOUT_ATTACHMENT',
    withoutHistoryDurationMs: Math.round(withoutHistoryDurationMs * 100) / 100,
    withHistoryDurationMs: Math.round(withHistoryDurationMs * 100) / 100,
    queryCharsWithoutHistory: withoutHistory.query.length,
    queryCharsWithHistory: withHistory.query.length,
  });
  assert.ok(withoutHistory.query.length <= 2_000);
  assert.ok(withHistory.query.length <= 2_000);
  assert.ok(withoutHistoryDurationMs < 1_000);
  assert.ok(withHistoryDurationMs < 1_000);
});
