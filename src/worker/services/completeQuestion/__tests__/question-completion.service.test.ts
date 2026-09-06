import assert from 'node:assert/strict';
import test from 'node:test';

function setBackendEnv() {
  process.env.NODE_ENV = 'test'; process.env.HOST = '127.0.0.1'; process.env.PORT = '3000';
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'key'; process.env.DATABASE_URL = 'https://database.example.com';
  process.env.REDIS_URL = 'https://redis.example.com'; process.env.OPENROUTER_API_KEY = 'key';
  process.env.OPENROUTER_EMBEDDING_MODEL = 'embedding'; process.env.OPENROUTER_QUESTION_MODEL = 'chat';
}

const alternatives = ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, text: `opcao ${label}` }));
const input = {
  documentId: 'doc', sourceBlockId: null, questionNumber: '1', statement: 'Quanto e 1 + 1?',
  alternatives, correctAnswer: null, explanation: null, sourceContext: 'evidencia',
};

test('falha do gabarito nao impede gerar explicacao', async () => {
  setBackendEnv();
  const { QuestionCompletionService } = await import('../question-completion.service.js');
  const service = new QuestionCompletionService(
    { complete: async () => ({ alternatives, generated: false }) } as never,
    { complete: async () => ({ correctAnswer: null, generated: false, usedDocumentRag: false, decisionSource: null, failure: { agent: 'CORRECT_ANSWER', code: 'EMPTY_RESPONSE', model: 'm', attempts: 1 } }) } as never,
    { complete: async () => ({ explanation: 'A soma de 1 com 1 resulta em 2.', generated: true }) } as never,
  );
  const result = await service.complete(input);
  assert.equal(result.explanation, 'A soma de 1 com 1 resulta em 2.');
  assert.deepEqual(result.failedAgents, ['CORRECT_ANSWER']);
});

test('falha de alternativas nao impede tentar gabarito e explicacao independentemente', async () => {
  setBackendEnv();
  const { QuestionCompletionService } = await import('../question-completion.service.js');
  let answerCalled = false;
  let explanationCalled = false;
  const service = new QuestionCompletionService(
    { complete: async () => ({ alternatives, generated: false, failure: { agent: 'ALTERNATIVES', code: 'MODEL_OUTPUT_TRUNCATED', model: 'm', attempts: 1 } }) } as never,
    { complete: async () => { answerCalled = true; return { correctAnswer: 'A', generated: true, usedDocumentRag: false, decisionSource: 'MODEL_INFERENCE' }; } } as never,
    { complete: async () => { explanationCalled = true; return { explanation: 'A soma de 1 com 1 resulta em 2.', generated: true }; } } as never,
  );
  await service.complete(input);
  assert.equal(answerCalled, true);
  assert.equal(explanationCalled, true);
});

test('tenta explicar com enunciado e contexto quando alternativas estao vazias', async () => {
  setBackendEnv();
  const { QuestionCompletionService } = await import('../question-completion.service.js');
  let explanationInput: typeof input | undefined;
  const service = new QuestionCompletionService(
    { complete: async () => ({ alternatives: [], generated: false }) } as never,
    { complete: async () => ({ correctAnswer: 'A', generated: true, usedDocumentRag: false, decisionSource: 'MODEL_INFERENCE' }) } as never,
    { complete: async (receivedInput: typeof input) => {
      explanationInput = receivedInput;
      return { explanation: 'O contexto permite concluir a resposta.', generated: true };
    } } as never,
  );

  const result = await service.complete(input);

  assert.equal(result.explanation, 'O contexto permite concluir a resposta.');
  assert.equal(result.correctAnswer, null);
  assert.equal(explanationInput?.statement, input.statement);
  assert.equal(explanationInput?.sourceContext, input.sourceContext);
  assert.deepEqual(explanationInput?.alternatives, []);
});
