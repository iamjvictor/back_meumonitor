import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncPaymentAccountWebhookUseCase } from '../application/commands/sync-payment-account-webhook.use-case.js';

test('sincroniza o webhook da subconta e persiste o identificador retornado pelo Asaas', async () => {
  const persisted: Array<{ accountId: string; webhookId: string }> = [];
  const useCase = new SyncPaymentAccountWebhookUseCase({
    async findForWebhookSync() {
      return {
        id: 'payment-account-1', environment: 'PRODUCTION', providerWebhookId: null,
        credential: { ciphertext: 'ciphertext', nonce: 'nonce', authTag: 'tag', keyVersion: 1 },
      };
    },
    async setProviderWebhookId(accountId, webhookId) { persisted.push({ accountId, webhookId }); },
  }, {
    encrypt() { throw new Error('not used'); },
    decrypt(accountId, environment, credential) {
      assert.equal(accountId, 'payment-account-1');
      assert.equal(environment, 'PRODUCTION');
      assert.equal(credential.ciphertext, 'ciphertext');
      return 'subaccount-secret';
    },
  }, {
    async ensureAccountStatusWebhook(credential) {
      assert.equal(credential, 'subaccount-secret');
      return { webhookId: 'wh_subaccount_123' };
    },
  });

  const result = await useCase.execute('payment-account-1', 'PRODUCTION');

  assert.deepEqual(result, { accountId: 'payment-account-1', webhookId: 'wh_subaccount_123' });
  assert.deepEqual(persisted, [{ accountId: 'payment-account-1', webhookId: 'wh_subaccount_123' }]);
});
