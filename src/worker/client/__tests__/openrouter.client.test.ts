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

test('createStructuredChatCompletion rejeita resposta que falha na validacao local do schema', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ok: false }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const client = new OpenRouterClient();

  await assert.rejects(
    client.createStructuredChatCompletion({
      schemaName: 'test_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', const: true } },
        required: ['ok'],
      },
      messages: [{ role: 'user', content: 'retorne {"ok": true}' }],
      validate: (value: unknown) => {
        const parsed = value as { ok?: boolean };
        if (parsed.ok !== true) {
          const error = new Error('schema mismatch');
          Object.assign(error, { issues: [{ message: 'schema mismatch' }] });
          throw error;
        }
        return parsed;
      },
    } as never),
    (error: unknown) => (
      error instanceof StructuredCompletionError
      && error.code === 'INVALID_SCHEMA'
    ),
  );

  globalThis.fetch = originalFetch;
});

test('createStructuredChatCompletion rejeita resposta vazia ou somente com espacos', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '   ' } }],
  }), { status: 200 });
  await assert.rejects(
    new OpenRouterClient().createStructuredChatCompletion({
      schemaName: 'test_schema', schema: {}, messages: [{ role: 'user', content: 'retorne JSON' }],
    }),
    (error: unknown) => error instanceof StructuredCompletionError && error.code === 'EMPTY_RESPONSE',
  );
  globalThis.fetch = originalFetch;
});

test('createStructuredChatCompletion rejeita resposta truncada', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '{"ok":' } }],
  }), { status: 200 });
  await assert.rejects(
    new OpenRouterClient().createStructuredChatCompletion({
      schemaName: 'test_schema', schema: {}, messages: [{ role: 'user', content: 'retorne JSON' }],
    }),
    (error: unknown) => error instanceof StructuredCompletionError && error.code === 'MODEL_OUTPUT_TRUNCATED',
  );
  globalThis.fetch = originalFetch;
});

test('aborta chamada estruturada após timeout configurado', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (_url, init) => await new Promise((_resolve, reject) => {
    (init?.signal as AbortSignal).addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  await assert.rejects(new OpenRouterClient().createStructuredChatCompletion({ schemaName: 'x', schema: {}, messages: [{ role: 'user', content: 'x' }], timeoutMs: 5 }), (error: unknown) => error instanceof StructuredCompletionError && error.code === 'TIMEOUT');
  assert.equal(aborted, true);
  globalThis.fetch = originalFetch;
});

test('respeita signal previamente abortado', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new OpenRouterClient().createStructuredChatCompletion({
    schemaName: 'x', schema: {}, messages: [{ role: 'user', content: 'x' }], signal: controller.signal,
  }), (error: unknown) => error instanceof StructuredCompletionError && error.code === 'TIMEOUT');
});

test('timeout continua ativo durante o consumo do body', { concurrency: false }, async () => {
  setBackendEnv();
  const { OpenRouterClient, StructuredCompletionError } = await import('../openrouter.client.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((_resolve) => undefined),
  } as Response);
  await assert.rejects(new OpenRouterClient().createStructuredChatCompletion({
    schemaName: 'x', schema: {}, messages: [{ role: 'user', content: 'x' }], timeoutMs: 5,
  }), (error: unknown) => error instanceof StructuredCompletionError && error.code === 'TIMEOUT');
  globalThis.fetch = originalFetch;
});
