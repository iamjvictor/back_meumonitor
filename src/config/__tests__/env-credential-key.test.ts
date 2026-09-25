import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidAsaasCredentialEncryptionKey } from '../env.js';

test('aceita somente chave Asaas Base64 de exatamente 32 bytes', () => {
  const valid = Buffer.alloc(32, 7).toString('base64');
  assert.equal(isValidAsaasCredentialEncryptionKey(valid), true);
  assert.equal(isValidAsaasCredentialEncryptionKey(Buffer.alloc(31, 7).toString('base64')), false);
  assert.equal(isValidAsaasCredentialEncryptionKey('not-base64'), false);
  assert.equal(isValidAsaasCredentialEncryptionKey(`${valid}!`), false);
});
