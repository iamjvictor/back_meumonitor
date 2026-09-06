import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaPath = new URL('../../../prisma/schema.prisma', import.meta.url);

test('purchase persistence contract uses cent values and links subscriptions', async () => {
  const schema = await readFile(schemaPath, 'utf8');

  assert.match(schema, /model StudentPurchase \{/);
  assert.match(schema, /subtotalAmount\s+Int/);
  assert.match(schema, /discountAmount\s+Int/);
  assert.match(schema, /totalAmount\s+Int/);
  assert.match(schema, /idempotencyKey\s+String\s+@unique/);
  assert.match(schema, /gatewayPaymentId\s+String\?/);
  assert.match(schema, /model StudentPurchaseItem \{/);
  assert.match(schema, /unitAmount\s+Int/);
  assert.match(schema, /@@unique\(\[purchaseId, monitorId\]\)/);
  assert.match(schema, /purchaseId\s+String\?/);
  assert.match(schema, /gatewaySubscriptionId\s+String\?/);
  assert.match(schema, /currentPeriodStart\s+DateTime\?/);
  assert.match(schema, /currentPeriodEnd\s+DateTime\?/);
  assert.match(schema, /cancelAtPeriodEnd\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /cancelledAt\s+DateTime\?/);
});
