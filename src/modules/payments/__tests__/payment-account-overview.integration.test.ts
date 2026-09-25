import test from 'node:test';
import assert from 'node:assert/strict';
import { GetPaymentAccountOverviewUseCase } from '../application/queries/get-payment-account-overview.use-case.js';
import type { AccountOverviewMetrics, AsaasAccountOverviewProviderContract } from '../infrastructure/providers/asaas/asaas-account-overview.provider.js';

type Environment = 'sandbox' | 'production';
type Account = {
  id: string; providerAccountId: string; walletId: string; status: string;
  generalStatus: string; onboardingUrl: null; credentialRef: string;
  environment: Environment;
};

const metrics: AccountOverviewMetrics = {
  availableBalanceCents: 12345, receivedThisMonthCents: 67890,
  pendingReceivablesCents: 4567, pendingTransfersCount: 2,
  currency: 'BRL', asOf: '2026-09-25T15:00:00.000Z',
};

function fixture() {
  const accounts: Record<string, Account> = {
    teacherA: { id: 'account-a-sandbox', providerAccountId: 'asaas-a-sandbox', walletId: 'wallet-a', status: 'APPROVED', generalStatus: 'APPROVED', onboardingUrl: null, credentialRef: 'credential-a-sandbox', environment: 'sandbox' },
    teacherB: { id: 'account-b-sandbox', providerAccountId: 'asaas-b-sandbox', walletId: 'wallet-b', status: 'APPROVED', generalStatus: 'APPROVED', onboardingUrl: null, credentialRef: 'credential-b-sandbox', environment: 'sandbox' },
  };
  const provider: AsaasAccountOverviewProviderContract = {
    getOverview: async (input) => input.providerAccountId === 'asaas-a-sandbox'
      ? { kind: 'available', metrics }
      : { kind: 'unavailable', reason: 'PROVIDER_UNAVAILABLE' },
  };
  const useCase = (environment: Environment, selected = accounts) => new GetPaymentAccountOverviewUseCase(
    { findCurrentByUserId: async (userId: string) => {
      const account = selected[userId];
      return account?.environment === environment ? account : null;
    } },
    provider,
    { dashboardUrl: `https://${environment}.asaas.com/login`, resolveCredential: async (ref, context) => {
      assert.ok(context.userId.length > 0);
      return ref.endsWith(environment) ? `fake-${environment}-credential` : null;
    } },
  );
  return { accounts, useCase };
}

test('approved teacher returns the four provider KPIs without exposing credential', async () => {
  const { useCase } = fixture();
  const result = await useCase('sandbox').execute('teacherA', new Date(metrics.asOf));
  assert.deepEqual(result.metrics, metrics);
  assert.equal(JSON.stringify(result).includes('credential'), false);
});

test('provider outage preserves account and returns metrics null', async () => {
  const { useCase } = fixture();
  const result = await useCase('sandbox').execute('teacherB');
  assert.equal(result.account.id, 'account-b-sandbox');
  assert.equal(result.metrics, null);
});

test('sandbox and production account records are isolated', async () => {
  const { accounts, useCase } = fixture();
  const production: Account = { id: 'account-a-production', providerAccountId: 'asaas-a-production', walletId: 'wallet-a', status: 'APPROVED', generalStatus: 'APPROVED', onboardingUrl: null, credentialRef: 'credential-a-production', environment: 'production' };
  const selected = { teacherA: production };
  await assert.rejects(() => useCase('sandbox', selected).execute('teacherA'), { name: 'PaymentAccountNotFoundError' });
  const result = await useCase('production', selected).execute('teacherA');
  assert.equal(result.account.id, 'account-a-production');
  assert.equal(result.account.dashboardUrl, 'https://production.asaas.com/login');
});

test('teacher cannot read another teacher account', async () => {
  const { useCase } = fixture();
  const result = await useCase('sandbox').execute('teacherB');
  assert.equal(result.account.id, 'account-b-sandbox');
  assert.notEqual(result.account.id, 'account-a-sandbox');
});

test('overview reads the encrypted credential selected by the account environment', async () => {
  const { accounts, useCase } = fixture();
  const selected = { teacherA: accounts.teacherA! };
  const result = await useCase('sandbox', selected).execute('teacherA');
  assert.equal(result.metrics?.availableBalanceCents, metrics.availableBalanceCents);
  assert.equal(JSON.stringify(result).includes('fake-sandbox-credential'), false);
});
