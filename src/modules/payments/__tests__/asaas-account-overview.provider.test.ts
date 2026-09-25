import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasAccountOverviewProvider } from '../infrastructure/providers/asaas/asaas-account-overview.provider.js';

const now = new Date('2026-09-25T15:00:00.000Z');

function makeProvider(responses: Record<string, unknown>, logs: unknown[] = []) {
  const requests: Array<{ path: string; credential?: string }> = [];
  const provider = new AsaasAccountOverviewProvider({
    async request<T>(path: string, options: { method: 'GET'; credential?: string }) {
      requests.push({ path, credential: options.credential });
      const response = responses[path] ?? responses[path.replace(/[?&]limit=100&offset=\d+$/, (match) => match.startsWith('?') ? '?limit=100' : '&limit=100')];
      if (response instanceof Error) throw response;
      if (response && typeof response === 'object' && 'data' in response) return { ...(response as object), hasMore: 'hasMore' in response ? (response as { hasMore?: boolean }).hasMore : false } as T;
      return response as T;
    },
  }, { logger: (entry) => logs.push(entry) });
  return { provider, requests };
}

test('normaliza saldo, recebimentos do mês, pendências e transferências', async () => {
  const { provider, requests } = makeProvider({
    '/finance/balance': { balance: 1250 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: [{ value: 1200.5 }, { value: '1588.5' }] },
    '/payments/splits/received?status=AWAITING_CREDIT&limit=100': { data: [{ totalValue: 14.41 }, { totalValue: 0 }] },
    '/transfers?limit=100': { data: [{ status: 'PENDING' }, { status: 'IN_PROGRESS' }, { status: 'DONE' }] },
  });

  const result = await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now });
  assert.deepEqual(result, { kind: 'available', metrics: {
    availableBalanceCents: 125000, receivedThisMonthCents: 278900, pendingReceivablesCents: 1441,
    pendingTransfersCount: 2, currency: 'BRL', asOf: now.toISOString(),
  }});
  assert.ok(requests.every((request) => request.credential === 'secret'));
});

test('converte timeout/resposta indisponível em resultado controlado', async () => {
  const { provider } = makeProvider({ '/finance/balance': new Error('timeout') });
  assert.deepEqual(await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now }), { kind: 'unavailable', reason: 'PROVIDER_UNAVAILABLE' });
});

test('não registra nem retorna a credencial', async () => {
  const logs: unknown[] = [];
  const { provider } = makeProvider({
    '/finance/balance': { balance: 0 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: [] },
    '/payments/splits/received?status=AWAITING_CREDIT&limit=100': { data: [] },
    '/transfers?limit=100': { data: [] },
  }, logs);
  const result = await provider.getOverview({ providerAccountId: 'acc-1', credential: 'super-secret', now });
  assert.equal(JSON.stringify({ result, logs }).includes('super-secret'), false);
  assert.equal(result.kind, 'available');
});

test('registra um resumo sanitizado de cada resposta da API', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const { provider } = makeProvider({
    '/finance/balance': { balance: 10 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: [{ value: 1 }], hasMore: false },
    '/payments/splits/received?status=AWAITING_CREDIT&limit=100': { data: [{ totalValue: 14.41 }], hasMore: false },
    '/transfers?limit=100': { data: [{ status: 'PENDING' }], hasMore: false },
  }, logs);

  await provider.getOverview({ providerAccountId: 'acc-1', walletId: 'wallet-1', credential: 'secret', now });
  const responses = logs.filter((entry) => entry.event === 'payments.asaas_account_overview_response_received');
  assert.equal(responses.length, 4);
  assert.deepEqual(responses.map((entry) => entry.resource).sort(), ['balance', 'pending_transfers', 'received_payments', 'received_splits']);
  assert.ok(responses.every((entry) => entry.status === 'ok'));
  assert.equal(responses.every((entry) => entry.walletId === 'wallet-1'), true);
  assert.equal(responses.find((entry) => entry.resource === 'received_payments')?.itemCount, 1);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
});

test('registra resposta de erro sem expor o corpo do provedor', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const { provider } = makeProvider({ '/finance/balance': new Error('provider secret body: sk_test_supersecret') }, logs);
  await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now });
  const errorLog = logs.find((entry) => entry.event === 'payments.asaas_account_overview_response_received');
  assert.equal(errorLog?.resource, 'balance');
  assert.equal(errorLog?.status, 'error');
  assert.equal(errorLog?.errorType, 'Error');
  assert.equal(JSON.stringify(logs).includes('supersecret'), false);
});

test('marca lista sem data como resposta inválida', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const { provider } = makeProvider({
    '/finance/balance': { balance: 10 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: 'not-a-list' },
  }, logs);
  const result = await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now });
  assert.deepEqual(result, { kind: 'unavailable', reason: 'NOT_READY' });
  const receivedLog = logs.find((entry) => entry.resource === 'received_payments');
  assert.equal(receivedLog?.responseShape, 'invalid');
  assert.equal(receivedLog?.status, 'incomplete');
});

test('trata resposta incompleta e números inválidos como indisponibilidade', async () => {
  const { provider } = makeProvider({ '/finance/balance': { balance: 'not-a-number' } });
  assert.deepEqual(await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now }), { kind: 'unavailable', reason: 'NOT_READY' });
});

test('preserva saldo zero e ignora transferências concluídas/canceladas', async () => {
  const { provider } = makeProvider({
    '/finance/balance': { balance: 0 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: [{ value: 0 }] },
    '/payments/splits/received?status=AWAITING_CREDIT&limit=100': { data: [{ totalValue: 0 }] },
    '/transfers?limit=100': { data: [{ status: 'DONE' }, { status: 'CANCELLED' }] },
  });
  const result = await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now });
  assert.equal(result.kind, 'available');
  if (result.kind === 'available') assert.deepEqual(result.metrics, { availableBalanceCents: 0, receivedThisMonthCents: 0, pendingReceivablesCents: 0, pendingTransfersCount: 0, currency: 'BRL', asOf: now.toISOString() });
});

test('pagina listagens com mais de 100 itens', async () => {
  const responses: Record<string, unknown> = {
    '/finance/balance': { balance: 1 },
    '/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100': { data: Array.from({ length: 100 }, () => ({ value: 1 })), hasMore: true },
    '/payments/splits/received?status=AWAITING_CREDIT&limit=100': { data: [], hasMore: false },
    '/transfers?limit=100': { data: [], hasMore: false },
  };
  const { provider, requests } = makeProvider(responses);
  responses['/payments?dateCreated[ge]=2026-09-01&dateCreated[le]=2026-09-25&status=RECEIVED&limit=100&offset=100'] = { data: [{ value: 1 }], hasMore: false };
  const result = await provider.getOverview({ providerAccountId: 'acc-1', credential: 'secret', now });
  assert.equal(result.kind, 'available');
  if (result.kind === 'available') assert.equal(result.metrics.receivedThisMonthCents, 10100);
  assert.ok(requests.some((request) => request.path.endsWith('offset=100')));
});
