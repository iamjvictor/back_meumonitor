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
  process.env.QUESTION_COMPLETION_MODEL = 'openrouter/test-chat';
}

test('QuestionCompletionRequestService compacta o payload antes de repetir apos INVALID_SCHEMA', async () => {
  setBackendEnv();
  const { QuestionCompletionRequestService } = await import('../question-completion-request.service.js');

  const calls: Array<{ contentLength: number }> = [];
  const service = new QuestionCompletionRequestService({
    async createStructuredChatCompletion(input: {
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      validate?: (value: unknown) => { ok: boolean };
    }) {
      const contentLength = input.messages.find((message) => message.role === 'user')?.content.length ?? 0;
      calls.push({ contentLength });
      const raw = calls.length === 1 ? { ok: false } : { ok: true };
      return input.validate ? input.validate(raw) : raw;
    },
  } as never);

  const response = await service.request({
    task: 'question_explanation',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
    parser: {
      safeParse(value: unknown) {
        const parsed = value as { ok?: boolean };
        return parsed.ok === true
          ? { success: true as const, data: parsed }
          : { success: false as const, error: { issues: [{ message: 'expected ok=true' }] } };
      },
    },
    messages: [
      { role: 'system', content: 'Retorne JSON valido.' },
      { role: 'user', content: `Trecho:\n${'evidencia longa '.repeat(1200)}` },
    ],
  });

  assert.deepStrictEqual(response.data, { ok: true });
  assert.equal(response.attempts, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.contentLength < calls[0]!.contentLength);
});

test('QuestionCompletionRequestService respeita retryAfterMs em 429 antes de tentar novamente', async () => {
  setBackendEnv();
  const { QuestionCompletionRequestService } = await import('../question-completion-request.service.js');
  const { StructuredCompletionError } = await import('../../../client/openrouter.client.js');

  const delays: number[] = [];
  let attempts = 0;
  const service = new QuestionCompletionRequestService({
    async createStructuredChatCompletion() {
      attempts += 1;
      if (attempts === 1) {
        throw new StructuredCompletionError('RATE_LIMITED', 'OpenRouter chat falhou (429): too many requests', {
          model: 'openrouter/test-chat',
          statusCode: 429,
          retryAfterMs: 1200,
        } as never);
      }
      return { ok: true };
    },
  } as never, {
    sleep: async (milliseconds: number) => {
      delays.push(milliseconds);
    },
  } as never);

  const response = await service.request({
    task: 'question_answer',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
    parser: {
      safeParse(value: unknown) {
        return { success: true as const, data: value as { ok: boolean } };
      },
    },
    messages: [
      { role: 'system', content: 'Retorne JSON valido.' },
      { role: 'user', content: 'Pergunta curta' },
    ],
  });

  assert.deepStrictEqual(response.data, { ok: true });
  assert.equal(response.attempts, 2);
  assert.deepStrictEqual(delays, [1200]);
});
