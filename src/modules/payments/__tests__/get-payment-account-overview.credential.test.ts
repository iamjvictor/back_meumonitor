import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentAccountCredentialResolver } from '../application/queries/get-payment-account-overview.use-case.js';

const encrypted = { ciphertext: 'cipher', nonce: 'nonce', authTag: 'tag', keyVersion: 1 };

function resolverFixture(options: { credential?: any; decrypt?: (accountId: string, environment: any, value: any) => string } = {}) {
  const calls: any[] = [];
  const repository = {
    findCredentialByUserIdAndAccountId: async (userId: string, accountId: string) => {
      calls.push({ userId, accountId });
      return options.credential ?? null;
    },
  };
  const store = {
    encrypt: () => encrypted,
    decrypt: options.decrypt ?? (() => 'asaas-secret'),
  };
  return { resolver: createPaymentAccountCredentialResolver(repository, store, 'sandbox'), calls };
}

test('não resolve credencial de conta pertencente a outro professor', async () => {
  const { resolver, calls } = resolverFixture();
  assert.equal(await resolver('ref', { userId: 'teacher-a', accountId: 'account-b' }), null);
  assert.deepEqual(calls, [{ userId: 'teacher-a', accountId: 'account-b' }]);
});

test('não descriptografa credencial de ambiente divergente', async () => {
  const { resolver } = resolverFixture({ credential: { id: 'ref', accountId: 'account-1', environment: 'PRODUCTION', ...encrypted }, decrypt: () => { throw new Error('must not decrypt'); } });
  assert.equal(await resolver('ref', { userId: 'teacher-a', accountId: 'account-1' }), null);
});

test('trata ciphertext corrompido como credencial indisponível', async () => {
  const { resolver } = resolverFixture({ credential: { id: 'ref', accountId: 'account-1', environment: 'SANDBOX', ...encrypted }, decrypt: () => { throw new Error('bad auth tag'); } });
  assert.equal(await resolver('ref', { userId: 'teacher-a', accountId: 'account-1' }), null);
});

test('trata credencial ausente como indisponível', async () => {
  const { resolver } = resolverFixture();
  assert.equal(await resolver('ref', { userId: 'teacher-a', accountId: 'account-1' }), null);
});

test('resolve e descriptografa a credencial correta em memória', async () => {
  let decrypted = false;
  const { resolver } = resolverFixture({ credential: { id: 'ref', accountId: 'account-1', environment: 'SANDBOX', ...encrypted }, decrypt: (accountId, environment, value) => {
    decrypted = true;
    assert.equal(accountId, 'account-1');
    assert.equal(environment, 'SANDBOX');
    assert.deepEqual(value, encrypted);
    return 'asaas-secret';
  } });
  assert.equal(await resolver('ref', { userId: 'teacher-a', accountId: 'account-1' }), 'asaas-secret');
  assert.equal(decrypted, true);
});
