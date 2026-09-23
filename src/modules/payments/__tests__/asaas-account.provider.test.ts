import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasAccountProvider } from '../infrastructure/providers/asaas/asaas-account.provider.js';

test('provider cria subconta Asaas sem expor a apiKey no resultado de domínio', async () => {
  let request: { path: string; body: unknown } | undefined;
  const provider = new AsaasAccountProvider({
    async request<T>(path: string, options: { method: 'POST'; body: unknown }) {
      request = { path, body: options.body };
      return { id: 'acc_123', walletId: 'wal_123', apiKey: 'secret-once', status: 'PENDING', webhooks: [{ id: 'wh_subaccount_123' }] } as T;
    },
  }, {
    webhookUrl: 'https://api.test/webhooks/asaas',
    webhookEmail: 'financeiro@test.com',
    webhookAuthToken: 'a'.repeat(32),
  });

  const result = await provider.createSubaccount({
    name: 'Professora Ana',
    email: 'ana@example.com',
    cpfCnpj: '12345678901',
    mobilePhone: '11999999999',
    incomeValue: 5000,
    address: 'Rua A',
    addressNumber: '10',
    province: 'Centro',
    postalCode: '01001000',
  });

  assert.deepEqual(result, { providerAccountId: 'acc_123', walletId: 'wal_123', status: 'PENDING', onboardingUrl: null, webhookId: 'wh_subaccount_123' });
  assert.equal(request?.path, '/accounts');
  assert.deepEqual(request?.body, {
    name: 'Professora Ana',
    email: 'ana@example.com',
    cpfCnpj: '12345678901',
    mobilePhone: '11999999999',
    incomeValue: 5000,
    address: 'Rua A',
    addressNumber: '10',
    province: 'Centro',
    postalCode: '01001000',
    webhooks: [{
      name: 'MeuMonitor AI - Status da Conta',
      url: 'https://api.test/webhooks/asaas',
      email: 'financeiro@test.com',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: 'a'.repeat(32),
      sendType: 'SEQUENTIALLY',
      events: [
        'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
        'ACCOUNT_STATUS_DOCUMENT_APPROVED',
        'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_DOCUMENT_PENDING',
        'ACCOUNT_STATUS_DOCUMENT_REJECTED',
      ],
    }],
  });
});
