import assert from 'node:assert/strict';
import test from 'node:test';
import { StartPaymentAccountUseCase } from '../application/commands/start-payment-account.use-case.js';

test('passes the transient Asaas apiKey to persistence but never returns it publicly', async () => {
  let persisted: unknown;
  const repository = {
    async findCurrentByUserId() { return { currentPaymentAccount: null }; },
    async persistCreatedAccount(...args: unknown[]) { persisted = args; return { id: 'local-1', providerAccountId: 'acc-1' }; },
  } as any;
  const provider = {
    async createSubaccount() {
      const result: any = { providerAccountId: 'acc-1', walletId: 'wal-1', status: 'PENDING', onboardingUrl: null, webhookId: null };
      Object.defineProperty(result, 'apiKey', { value: 'secret-once', enumerable: false });
      return result;
    },
  } as any;

  const result = await new StartPaymentAccountUseCase(repository, provider).execute('user-1', { name: 'Ana', email: 'ana@example.com', cpfCnpj: '12345678901', mobilePhone: '11999999999', incomeValue: 5000, address: 'Rua A', addressNumber: '10', province: 'Centro', postalCode: '01001000' });

  assert.equal((persisted as any[])[2].apiKey, 'secret-once');
  assert.equal('apiKey' in result, false);
});
