import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentAccountCredentialCrypto } from '../infrastructure/credentials/payment-account-credential.crypto.js';

const masterKey = Buffer.alloc(32, 7).toString('base64');

function withKey(value: string | undefined, fn: () => void): void {
  const previous = process.env.PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY;
  if (value === undefined) delete process.env.PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY;
  else process.env.PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY = value;
  try { fn(); } finally {
    if (previous === undefined) delete process.env.PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY;
    else process.env.PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY = previous;
  }
}

test('encrypts and decrypts credentials with AES-256-GCM', () => {
  withKey(masterKey, () => {
    const crypto = new PaymentAccountCredentialCrypto();
    const encrypted = crypto.encrypt('account-a', 'SANDBOX', 'sandbox-secret');
    assert.equal(crypto.decrypt('account-a', 'SANDBOX', encrypted), 'sandbox-secret');
    assert.notEqual(encrypted.ciphertext, 'sandbox-secret');
  });
});

test('uses a fresh nonce for every encryption', () => {
  withKey(masterKey, () => {
    const crypto = new PaymentAccountCredentialCrypto();
    const first = crypto.encrypt('account-a', 'SANDBOX', 'same-secret');
    const second = crypto.encrypt('account-a', 'SANDBOX', 'same-secret');
    assert.notEqual(first.nonce, second.nonce);
  });
});

test('rejects a missing or invalid master key', () => {
  withKey(undefined, () => assert.throws(() => new PaymentAccountCredentialCrypto(), /master key/i));
  withKey(Buffer.alloc(16).toString('base64'), () => assert.throws(() => new PaymentAccountCredentialCrypto(), /32 bytes|master key/i));
});

test('binds ciphertext to account and environment through AAD', () => {
  withKey(masterKey, () => {
    const crypto = new PaymentAccountCredentialCrypto();
    const encrypted = crypto.encrypt('account-a', 'SANDBOX', 'secret');
    assert.throws(() => crypto.decrypt('account-b', 'SANDBOX', encrypted));
    assert.throws(() => crypto.decrypt('account-a', 'PRODUCTION', encrypted));
  });
});

test('persistable encrypted value and logging never contain plaintext', () => {
  withKey(masterKey, () => {
    const logs: unknown[] = [];
    const crypto = new PaymentAccountCredentialCrypto({ logger: entry => logs.push(entry) });
    const encrypted = crypto.encrypt('account-a', 'SANDBOX', 'do-not-log-me');
    assert.equal(JSON.stringify(encrypted).includes('do-not-log-me'), false);
    assert.equal(JSON.stringify(logs).includes('do-not-log-me'), false);
  });
});
