import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('GET /subscriptions delega para a listagem de billing', async () => {
  const source = await readFile(new URL('../billing.routes.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/subscriptions', auth, subscriptionController\.list\.bind\(subscriptionController\)\)/);
});

test('não registra fallback de subscriptions quando a camada legada é desativada', async () => {
  const source = await readFile(new URL('../billing.routes.ts', import.meta.url), 'utf8');
  assert.match(source, /options\.includeSubscriptions !== false/);
  assert.match(source, /if \(options\.includeSubscriptions !== false\)/);
});
