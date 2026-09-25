import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentAccountRepository } from '../infrastructure/persistence/payment-account.repository.js';

const input = {
  name: 'Ana', email: 'ana@example.com', cpfCnpj: '12345678901', mobilePhone: '11999999999', incomeValue: 5000,
  address: 'Rua A', addressNumber: '10', province: 'Centro', postalCode: '01001000',
};
const created = { providerAccountId: 'acc-1', walletId: 'wal-1', status: 'PENDING', onboardingUrl: null, webhookId: null, apiKey: 'secret-once' };

function makeDatabase(options: { failAt?: 'credential' | 'link' } = {}) {
  const calls: string[] = [];
  const database = {
    async $transaction<T>(callback: (transaction: any) => Promise<T>) {
      const transaction = {
        teacher: {
          findUniqueOrThrow: async () => ({ id: 'teacher-1' }),
          update: async () => { calls.push('teacher.update'); if (options.failAt === 'link') throw new Error('link failed'); },
        },
        paymentAccount: {
          findFirst: async () => ({ revision: 0 }),
          create: async ({ data }: any) => { calls.push('account.create'); return { id: data.id ?? 'account-1', ...data }; },
          update: async () => { calls.push('account.update'); },
        },
        paymentAccountCredential: {
          create: async () => { calls.push('credential.create'); if (options.failAt === 'credential') throw new Error('credential failed'); },
        },
        teacherPaymentProfile: { create: async () => { calls.push('profile.create'); } },
      };
      try { return await callback(transaction); } catch (error) { calls.push('transaction.rollback'); throw error; }
    },
  };
  return { database, calls };
}

test('vincula o professor somente depois de criar a credencial cifrada', async () => {
  const { database, calls } = makeDatabase();
  const repository = new PaymentAccountRepository({ encrypt: () => ({ ciphertext: 'c', nonce: 'n', authTag: 't', keyVersion: 1 }), decrypt: () => 'secret' }, database as any);
  await repository.persistCreatedAccount('user-1', input, created as any);
  assert.deepEqual(calls.slice(0, 5), ['account.create', 'credential.create', 'account.update', 'profile.create', 'teacher.update']);
});

test('falha da credencial aborta antes de vincular o professor', async () => {
  const { database, calls } = makeDatabase({ failAt: 'credential' });
  const repository = new PaymentAccountRepository({ encrypt: () => { throw new Error('encryption failed'); }, decrypt: () => 'secret' }, database as any);
  await assert.rejects(() => repository.persistCreatedAccount('user-1', input, created as any), /encryption failed/);
  assert.equal(calls.includes('teacher.update'), false);
  assert.equal(calls.includes('transaction.rollback'), true);
});
