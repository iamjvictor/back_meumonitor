import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const schemaPath = resolve(rootPath, 'prisma/schema.prisma');
const migrationPath = resolve(rootPath, 'prisma/migrations/20260925000000_payment_account_credentials/migration.sql');

test('PaymentAccountCredential stores one encrypted credential per account and environment', async () => {
  const source = await readFile(schemaPath, 'utf8');
  assert.match(source, /model PaymentAccountCredential \{/);
  assert.match(source, /paymentAccountId\s+String\s+@unique\s+@map\("payment_account_id"\)\s+@db\.Uuid/);
  assert.match(source, /environment\s+String/);
  assert.match(source, /ciphertext\s+String/);
  assert.match(source, /nonce\s+String/);
  assert.match(source, /authTag\s+String\s+@map\("auth_tag"\)/);
  assert.match(source, /keyVersion\s+Int\s+@default\(1\)\s+@map\("key_version"\)/);
  assert.match(source, /paymentAccount\s+PaymentAccount\s+@relation\([^\n]*onDelete: Cascade/);
  assert.match(source, /@@unique\(\[paymentAccountId, environment\]\)/);
});

test('migration enforces required encrypted fields, positive key versions and cascade deletion', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /"ciphertext" TEXT NOT NULL/);
  assert.match(migration, /"nonce" TEXT NOT NULL/);
  assert.match(migration, /"auth_tag" TEXT NOT NULL/);
  assert.match(migration, /CHECK \("key_version" > 0\)/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /payment_account_id_environment_key/);
});
