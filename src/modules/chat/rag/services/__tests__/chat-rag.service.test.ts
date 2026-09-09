import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatKnowledgePort } from '../../ports/chat-knowledge.port.js';
import type { ChatRagInput } from '../../models/chat-rag.model.js';
import type { QuestionEvidenceResult } from '../../models/question-evidence.model.js';
import type { ChatEvidenceCachePort } from '../../ports/question-evidence.port.js';
import type { ChatRagResult } from '../../models/chat-rag.model.js';
import { ChatRagService } from '../chat-rag.service.js';

function makeInput(overrides: Partial<ChatRagInput> = {}): ChatRagInput {
  return {
    message: 'Qual é a alternativa correta?',
    history: [],
    questionContext: null,
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: null,
    ...overrides,
  };
}

function makeQuestionEvidence(): QuestionEvidenceResult {
  return {
    strategy: 'DIRECT_QUESTION_SOURCE',
    sufficient: true,
    questionId: 'question-1',
    answer: 'C',
    explanation: 'A unidade deve ser convertida antes da razão.',
    citations: [{
      chunkId: 'chunk-answer',
      documentId: 'document-1',
      blockId: 'block-answer',
      role: 'ANSWER_KEY',
      content: 'Resposta: C. A unidade deve ser convertida antes da razão.',
      confidence: 0.98,
      pageStart: 4,
      pageEnd: 4,
    }],
    context: '[GABARITO OFICIAL]\nC',
    metrics: {
      sourceCount: 1,
      chunkCount: 1,
      answerKeyCount: 1,
      explanationCount: 0,
      durationMs: 12,
    },
  };
}

test('usa evidência oficial sem chamar retrieval semântico', async () => {
  let retrievalCalls = 0;
  const knowledge: ChatKnowledgePort = {
    async retrieve() {
      retrievalCalls += 1;
      throw new Error('retrieval não deveria ser chamado');
    },
  };
  const service = new ChatRagService(knowledge);

  const result = await service.enrich(makeInput({
    questionEvidence: makeQuestionEvidence(),
  }));

  assert.equal(retrievalCalls, 0);
  assert.equal(result.result.used, true);
  assert.equal(result.result.citations[0]?.chunkId, 'chunk-answer');
  assert.match(result.context, /Resposta: C/);
});

test('usa retrieval semântico quando a evidência oficial não é suficiente', async () => {
  let retrievalCalls = 0;
  const knowledge: ChatKnowledgePort = {
    async retrieve(input) {
      retrievalCalls += 1;
      return {
        used: false,
        retrievalQuery: input.message,
        context: '',
        citations: [],
        metrics: { candidateCount: 0, selectedCount: 0, durationMs: 20 },
      };
    },
  };
  const service = new ChatRagService(knowledge);

  await service.enrich(makeInput({
    questionEvidence: { ...makeQuestionEvidence(), sufficient: false },
  }));

  assert.equal(retrievalCalls, 1);
});

test('usa cache de evidência oficial antes do retrieval e registra a consulta sem mensagem do aluno', async () => {
  let retrievalCalls = 0;
  let cacheWrites = 0;
  const cached: ChatRagResult = {
    used: true,
    retrievalQuery: '',
    context: '[GABARITO OFICIAL]\nC\n\n[EXPLICAÇÃO OFICIAL]\nFonte em cache',
    citations: [],
    metrics: { candidateCount: 1, selectedCount: 1, durationMs: 2 },
  };
  const cache: ChatEvidenceCachePort = {
    async getQuestion() { return cached; },
    async setQuestion() { cacheWrites += 1; },
    async getFlashcard() { return null; },
    async setFlashcard() { cacheWrites += 1; },
  };
  const knowledge: ChatKnowledgePort = {
    async retrieve() {
      retrievalCalls += 1;
      throw new Error('retrieval não deveria ser chamado');
    },
  };

  const service = new ChatRagService(knowledge, undefined, undefined, cache);
  const result = await service.enrich(makeInput({ questionId: 'question-1' }));

  assert.equal(retrievalCalls, 0);
  assert.equal(cacheWrites, 0);
  assert.equal(result.result.retrievalQuery, '');
  assert.match(result.context, /Fonte em cache/);
});

test('grava evidência direta normalizada no cache quando não há hit', async () => {
  let cacheWrites = 0;
  const cache: ChatEvidenceCachePort = {
    async getQuestion() { return null; },
    async setQuestion(_input, result) {
      cacheWrites += 1;
      assert.equal(result.retrievalQuery, '');
      assert.doesNotMatch(result.context, /mensagem privada/);
    },
    async getFlashcard() { return null; },
    async setFlashcard() { cacheWrites += 1; },
  };

  const service = new ChatRagService({ async retrieve() { throw new Error('não deveria'); } }, undefined, undefined, cache);
  await service.enrich(makeInput({ message: 'mensagem privada', questionEvidence: makeQuestionEvidence() }));

  assert.equal(cacheWrites, 1);
});
