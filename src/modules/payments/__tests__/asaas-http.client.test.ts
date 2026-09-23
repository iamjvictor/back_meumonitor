import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasApiError, AsaasHttpClient } from '../infrastructure/providers/asaas/asaas-http.client.js';

test('cliente Asaas envia access_token, user-agent e corpo JSON', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new AsaasHttpClient({
    apiKey: 'sandbox-secret',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ id: 'co_123' }), { status: 200 });
    },
  });

  const result = await client.request<{ id: string }>('/checkouts', {
    method: 'POST',
    body: { name: 'Monitor' },
  });

  assert.deepEqual(result, { id: 'co_123' });
  assert.equal(calls[0]?.url, 'https://api-sandbox.asaas.com/v3/checkouts');
  assert.equal(new Headers(calls[0]?.init.headers).get('access_token'), 'sandbox-secret');
  assert.equal(new Headers(calls[0]?.init.headers).get('user-agent'), 'MeuMonitorAI');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { name: 'Monitor' });
});

test('cliente Asaas preserva a mensagem de validação do provedor para diagnóstico', async () => {
  const client = new AsaasHttpClient({
    apiKey: 'secret',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    timeoutMs: 1000,
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ description: 'CPF interno' }] }), { status: 401 }),
  });

  await assert.rejects(
    client.request('/customers', { method: 'GET' }),
    (error: unknown) => error instanceof AsaasApiError && error.status === 401 && error.message.includes('CPF interno') && error.responseBody !== undefined,
  );
});

test('cliente Asaas converte timeout em erro estável', async () => {
  const client = new AsaasHttpClient({
    apiKey: 'secret',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    timeoutMs: 1,
    fetchImpl: async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      throw new Error('unreachable');
    },
  });

  await assert.rejects(client.request('/payments', { method: 'GET' }), /Asaas request timed out/);
});
