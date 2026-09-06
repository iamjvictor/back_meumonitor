import assert from 'node:assert/strict';
import test from 'node:test';

function setBackendEnv() {
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3000';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DATABASE_URL = 'https://database.example.com';
  process.env.REDIS_URL = 'https://redis.example.com';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENROUTER_EMBEDDING_MODEL = 'openrouter/test-embedding';
  process.env.OPENROUTER_QUESTION_MODEL = 'openrouter/test-chat';
}

test('classifyTopicBatch divide batches e reduz payload apos 429', async () => {
  setBackendEnv();
  const { classifyTopicBatch } = await import('../document-block-topic-classification.service.js');
  const { StructuredCompletionError } = await import('../../client/openrouter.client.js');

  const requestPayloads: Array<{ blockCount: number; payloadChars: number }> = [];
  let attempts = 0;
  const result = await classifyTopicBatch({
    async createStructuredChatCompletion(input: { messages: Array<{ role: 'system' | 'user'; content: string }> }) {
      const userContent = input.messages.find((message) => message.role === 'user')?.content ?? '';
      const parsed = JSON.parse(userContent) as { blocks: unknown[] };
      requestPayloads.push({ blockCount: parsed.blocks.length, payloadChars: userContent.length });
      attempts += 1;
      if (attempts === 1) {
        throw new StructuredCompletionError('RATE_LIMITED', 'OpenRouter chat falhou (429): too many requests', {
          model: 'openrouter/test-chat',
          statusCode: 429,
          retryAfterMs: 10,
        } as never);
      }

      return {
        classifications: parsed.blocks.map((block) => ({
          blockIndex: (block as { blockIndex: number }).blockIndex,
          primaryTopicId: '11111111-1111-4111-8111-111111111111',
        })),
      };
    },
  } as never, [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Razao e proporcao',
      definition: 'definicao '.repeat(200),
      classificationGuidance: 'guia '.repeat(300),
      aiDefinition: 'ia '.repeat(200),
      aiClassificationGuidance: 'orientacao '.repeat(300),
    },
  ], [
    {
      id: 'block-1',
      blockIndex: 0,
      type: 'QUESTION',
      title: 'Questao 1',
      normalizedContent: 'conteudo '.repeat(800),
      sectionPath: 'capitulo 1',
    },
    {
      id: 'block-2',
      blockIndex: 1,
      type: 'QUESTION',
      title: 'Questao 2',
      normalizedContent: 'conteudo '.repeat(800),
      sectionPath: 'capitulo 1',
    },
  ], {
    sleep: async () => undefined,
  } as never);

  assert.equal(result.length, 2);
  assert.ok(requestPayloads.length >= 2);
  assert.equal(requestPayloads[0]!.blockCount, 2);
  assert.ok(requestPayloads.some((payload) => payload.blockCount === 1));
  assert.ok(requestPayloads.at(-1)!.payloadChars < requestPayloads[0]!.payloadChars);
});

test('usa o primeiro topico permitido como fallback quando a classificacao nao tem principal', async () => {
  const { resolveBlockTopicFallback } = await import('../document-block-topic-classification.service.js');

  assert.deepEqual(resolveBlockTopicFallback([
    { id: 'topic-1' },
    { id: 'topic-2' },
  ]), { topicId: 'topic-1', confidence: 0, classificationMethod: 'RULE' });
});

test('rejeita resposta estruturada sem cobertura exata dos blocos', async () => {
  setBackendEnv();
  const { classifyTopicBatch } = await import('../document-block-topic-classification.service.js');
  const topicId = '11111111-1111-4111-8111-111111111111';

  await assert.rejects(
    classifyTopicBatch({
      async createStructuredChatCompletion() {
        return { classifications: [{ blockIndex: 0, primaryTopicId: topicId }] };
      },
    } as never, [{
      id: topicId,
      name: 'Razao e proporcao',
      definition: null,
      classificationGuidance: null,
      aiDefinition: null,
      aiClassificationGuidance: null,
    }], [
      { id: 'block-1', blockIndex: 0, type: 'THEORY', title: null, normalizedContent: 'a', sectionPath: null },
      { id: 'block-2', blockIndex: 1, type: 'THEORY', title: null, normalizedContent: 'b', sectionPath: null },
    ], { sleep: async () => undefined } as never),
    (error: unknown) => error instanceof Error && error.message.includes('nao cobriu exatamente'),
  );
});
