import test from 'node:test';
import assert from 'node:assert/strict';
import { GetPaymentAccountOverviewUseCase } from '../application/queries/get-payment-account-overview.use-case.js';

const account = {
  id: 'local-1', providerAccountId: 'asaas-1', walletId: 'wallet-1', status: 'APPROVED',
  generalStatus: 'APPROVED', onboardingUrl: null, credentialRef: 'secret-ref',
};
const metrics = { availableBalanceCents: 10, receivedThisMonthCents: 20, pendingReceivablesCents: 30, pendingTransfersCount: 1, currency: 'BRL' as const, asOf: '2026-09-25T15:00:00.000Z' };

test('monta conta aprovada e métricas sem incluir credencial', async () => {
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async (userId: string) => { assert.equal(userId, 'user-1'); return account; } },
    { getOverview: async (input: { credential: string }) => { assert.equal(input.credential, 'secret'); return { kind: 'available', metrics }; } },
    { dashboardUrl: 'https://www.asaas.com/login', resolveCredential: async () => 'secret' },
  );
  const result = await useCase.execute('user-1', new Date('2026-09-25T15:00:00.000Z'));
  assert.deepEqual(result, { account: { id: account.id, providerAccountId: account.providerAccountId, walletId: account.walletId, status: account.status, generalStatus: account.generalStatus, onboardingUrl: account.onboardingUrl, dashboardUrl: 'https://www.asaas.com/login' }, metrics });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(Object.keys(result.account).some((key) => /credential|apiKey|token/i.test(key)), false);
});

test('conta inexistente falha com erro de conta não encontrada', async () => {
  const useCase = new GetPaymentAccountOverviewUseCase({ findCurrentByUserId: async () => null }, {} as never);
  await assert.rejects(() => useCase.execute('missing'), { name: 'PaymentAccountNotFoundError' });
});

test('teacher wrapper sem currentPaymentAccount falha com conta não encontrada', async () => {
  const useCase = new GetPaymentAccountOverviewUseCase({ findCurrentByUserId: async () => ({ id: 'teacher-1', currentPaymentAccount: null }) }, {} as never);
  await assert.rejects(() => useCase.execute('user-1'), { name: 'PaymentAccountNotFoundError' });
});

test('conta pendente não consulta provider e retorna métricas nulas', async () => {
  let called = false;
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async () => ({ ...account, status: 'PENDING' }) },
    { getOverview: async () => { called = true; return { kind: 'available', metrics }; } },
    { dashboardUrl: 'https://www.asaas.com/login', resolveCredential: async () => 'secret' },
  );
  const result = await useCase.execute('user-1');
  assert.equal(result.metrics, null);
  assert.equal(called, false);
});

test('sem estratégia segura de credencial falha fechado com métricas nulas', async () => {
  let called = false;
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async () => account },
    { getOverview: async () => { called = true; return { kind: 'available', metrics }; } },
    { dashboardUrl: null },
  );
  const result = await useCase.execute('user-1');
  assert.equal(result.metrics, null);
  assert.equal(called, false);
});

test('provider indisponível mantém conta e métricas nulas', async () => {
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async () => account },
    { getOverview: async () => ({ kind: 'unavailable', reason: 'PROVIDER_UNAVAILABLE' }) },
    { dashboardUrl: 'https://www.asaas.com/login', resolveCredential: async () => 'secret' },
  );
  assert.equal((await useCase.execute('user-1')).metrics, null);
});

test('registra diagnóstico quando resolver de credencial não está configurado', async () => {
  const entries: Record<string, unknown>[] = [];
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async () => account },
    { getOverview: async () => ({ kind: 'available', metrics }) },
    { dashboardUrl: null, logger: (entry) => entries.push(entry) },
  );
  await useCase.execute('user-1');
  assert.equal(entries.at(-1)?.event, 'payments.account_overview_metrics_unavailable');
  assert.equal(entries.at(-1)?.reason, 'CREDENTIAL_RESOLVER_NOT_CONFIGURED');
  assert.equal(entries.at(-1)?.providerAccountId, 'asaas-1');
  assert.equal(entries.at(-1)?.walletId, 'wallet-1');
});

test('registra diagnóstico para conta não aprovada e IDs ausentes', async () => {
  const cases = [
    { source: { ...account, status: 'PENDING' }, reason: 'ACCOUNT_NOT_APPROVED' },
    { source: { ...account, providerAccountId: null }, reason: 'PROVIDER_ACCOUNT_ID_MISSING' },
    { source: { ...account, credentialRef: null }, reason: 'CREDENTIAL_REF_MISSING' },
  ];
  for (const item of cases) {
    const entries: Record<string, unknown>[] = [];
    const useCase = new GetPaymentAccountOverviewUseCase(
      { findCurrentByUserId: async () => item.source }, {} as never,
      { dashboardUrl: null, logger: (entry) => entries.push(entry) },
    );
    await useCase.execute('user-1');
    assert.equal(entries.at(-1)?.reason, item.reason);
  }
});

test('registra resolução e resultado do provider sem expor a credencial', async () => {
  const entries: Record<string, unknown>[] = [];
  const useCase = new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async () => account },
    { getOverview: async (input: { credential: string }) => { assert.equal(input.credential, 'secret'); return { kind: 'available', metrics }; } },
    { dashboardUrl: null, resolveCredential: async () => 'secret', logger: (entry) => entries.push(entry) },
  );
  const result = await useCase.execute('user-1');
  assert.equal(result.metrics, metrics);
  assert.deepEqual(entries.map((entry) => entry.event), [
    'payments.account_overview_credential_resolution_started',
    'payments.account_overview_credential_resolution_completed',
    'payments.account_overview_provider_result',
  ]);
  assert.equal(JSON.stringify(entries).includes('secret'), false);
});
