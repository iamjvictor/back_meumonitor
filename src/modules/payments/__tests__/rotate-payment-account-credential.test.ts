import assert from 'node:assert/strict';
import test from 'node:test';
import { RotatePaymentAccountCredentialUseCase } from '../application/commands/rotate-payment-account-credential.use-case.js';

function repository() {
  const calls: unknown[] = [];
  const saved = new Map<string, unknown>(); return { calls, findCredentialOperation: async (_u:string,_e:string,o:string,k:string) => saved.has(o+k) ? { result: saved.get(o+k) } : null, rotateCredentialWithOperation: async (_u:string,_e:string,k:string,_encrypted:unknown,_id:string,result:unknown) => { saved.set('ROTATE'+k,result); calls.push(result); return result; }, revokeCredentialWithOperation: async (_u:string,_e:string,k:string,result:unknown) => { saved.set('REVOKE'+k,result); calls.push(result); return result; }, findAccountByUserAndEnvironment: async (userId: string, environment: string) => userId === 'teacher-1' && environment === 'SANDBOX' ? { id: 'account-1', environment: 'SANDBOX' } : null } as any;
}

test('rotates only an owned account in the confirmed environment and never returns the secret', async () => {
  const repo = repository();
  const useCase = new RotatePaymentAccountCredentialUseCase(repo, { encrypt: () => ({ ciphertext: 'cipher', nonce: 'nonce', authTag: 'tag', keyVersion: 1 }) } as any);
  const result = await useCase.execute({ userId: 'teacher-1', environment: 'sandbox', operationKey: 'op-1', credential: 'new-secret' });
  assert.equal((result as any).accountId, 'account-1'); assert.equal((result as any).environment, 'SANDBOX'); assert.match((result as any).credentialId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('same operation key is idempotent and does not replace twice', async () => {
  const repo = repository();
  const useCase = new RotatePaymentAccountCredentialUseCase(repo, { encrypt: () => ({ ciphertext: 'cipher', nonce: 'nonce', authTag: 'tag', keyVersion: 1 }) } as any);
  const first = await useCase.execute({ userId: 'teacher-1', environment: 'sandbox', operationKey: 'op-1', credential: 'new-secret' });
  const second = await useCase.execute({ userId: 'teacher-1', environment: 'sandbox', operationKey: 'op-1', credential: 'other-secret' });
  assert.deepEqual(second, first);
  assert.equal(repo.calls.length, 1);
});

test('revocation removes local ciphertext and does not call a remote provider', async () => {
  const repo = repository();
  const useCase = new RotatePaymentAccountCredentialUseCase(repo, {} as any);
  const result = await useCase.revoke({ userId: 'teacher-1', environment: 'sandbox', operationKey: 'op-revoke' });
  assert.deepEqual(result, { accountId: 'account-1', environment: 'SANDBOX', revoked: true });
  assert.equal(repo.calls.length, 1);
});
