import assert from 'node:assert/strict';
import test from 'node:test';
import { StartPaymentAccountUseCase } from '../application/commands/start-payment-account.use-case.js';
import { RotatePaymentAccountCredentialUseCase } from '../application/commands/rotate-payment-account-credential.use-case.js';
import { GetPaymentAccountOverviewUseCase, createPaymentAccountCredentialResolver } from '../application/queries/get-payment-account-overview.use-case.js';

test('criação → credencial cifrada → overview → rotação mantém segredo fora do contrato', async () => {
  const credentials = new Map<string, any>();
  const plaintextByCiphertext = new Map<string, string>();
  const accounts = new Map<string, any>();
  const store = {
    encrypt: (_accountId: string, environment: string, plaintext: string) => { const ciphertext = `cipher:${environment}:${plaintext.length}:${plaintextByCiphertext.size}`; plaintextByCiphertext.set(ciphertext, plaintext); return { ciphertext, nonce: 'nonce', authTag: 'tag', keyVersion: 1 }; },
    decrypt: (_accountId: string, _environment: string, value: any) => plaintextByCiphertext.get(value.ciphertext)!,
  } as any;
  const repository = {
    findCurrentByUserId: async () => ({ currentPaymentAccount: accounts.get('teacher-1') ?? null }),
    persistCreatedAccount: async (_userId: string, _input: unknown, created: any) => {
      const account = { id: 'account-1', providerAccountId: created.providerAccountId, walletId: created.walletId, status: 'APPROVED', generalStatus: 'APPROVED', onboardingUrl: null, credentialRef: 'credential-1', environment: 'SANDBOX' };
      accounts.set('teacher-1', account);
      credentials.set(account.id, { id: account.credentialRef, accountId: account.id, environment: 'SANDBOX', ...store.encrypt(account.id, 'SANDBOX', created.apiKey) });
      return { id: account.id, providerAccountId: account.providerAccountId };
    },
    findCredentialByUserIdAndAccountId: async (_userId: string, accountId: string) => credentials.get(accountId) ?? null,
    findAccountByUserAndEnvironment: async (_userId: string, environment: string) => accounts.get('teacher-1')?.environment === environment ? { id: 'account-1', environment } : null,
    rotateCredentialWithOperation: async (_userId: string, _environment: string, _key: string, encrypted: any, credentialId: string, result: any) => {
      credentials.set('account-1', { id: credentialId, accountId: 'account-1', environment: 'SANDBOX', ...encrypted });
      accounts.get('teacher-1').credentialRef = credentialId;
      return result;
    },
    findCredentialOperation: async () => null,
  } as any;
  const provider = { createSubaccount: async () => ({ providerAccountId: 'asaas-1', walletId: 'wallet-1', status: 'APPROVED', onboardingUrl: null, webhookId: null, apiKey: 'first-secret' }), getOverview: async ({ credential }: any) => ({ kind: 'available', metrics: { availableBalanceCents: credential === 'first-secret' ? 100 : 200, receivedThisMonthCents: 0, pendingReceivablesCents: 0, pendingTransfersCount: 0, currency: 'BRL', asOf: new Date().toISOString() } }) } as any;
  const input = { name: 'Ana', email: 'ana@example.com', cpfCnpj: '12345678901', mobilePhone: '11999999999', incomeValue: 5000, address: 'Rua A', addressNumber: '10', province: 'Centro', postalCode: '01001000' };
  const created = await new StartPaymentAccountUseCase(repository, provider).execute('teacher-1', input);
  assert.deepEqual(created, { id: 'account-1', providerAccountId: 'asaas-1' });
  assert.equal(JSON.stringify(credentials.get('account-1')).includes('first-secret'), false);
  const overview = () => new GetPaymentAccountOverviewUseCase(repository, provider, { dashboardUrl: null, resolveCredential: createPaymentAccountCredentialResolver(repository, store, 'sandbox') });
  assert.equal((await overview().execute('teacher-1')).metrics?.availableBalanceCents, 100);
  const rotated = await new RotatePaymentAccountCredentialUseCase(repository, store).execute({ userId: 'teacher-1', environment: 'sandbox', operationKey: 'rotate-1', credential: 'second-secret' });
  assert.equal((rotated as any).environment, 'SANDBOX');
  assert.equal(JSON.stringify(rotated).includes('second-secret'), false);
  assert.equal((await overview().execute('teacher-1')).metrics?.availableBalanceCents, 200);
});
