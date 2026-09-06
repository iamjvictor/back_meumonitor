import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('billing schema declares aggregate persistence constraints', async () => {
  const schema = await readFile(new URL('../../../../../prisma/schema.prisma', import.meta.url), 'utf8');
  for (const model of ['StripeCustomer', 'BillingSubscription', 'BillingSubscriptionItem', 'StudentEnrollment', 'BillingWebhookEvent']) assert.match(schema, new RegExp(`model ${model} \\{`));
  assert.match(schema, /model BillingSubscription \{[\s\S]*?studentId\s+String\s+@map\("student_id"\)/);
  assert.doesNotMatch(schema, /model BillingSubscription \{[\s\S]*?studentId\s+String\s+@unique/);
  assert.match(schema, /subscriptionItemId\s+String\s+@map\("subscription_item_id"\)/);
  assert.match(schema, /@@unique\(\[subscriptionId, monitorId\]\)/);
  assert.match(schema, /@@unique\(\[studentId, monitorId\]\)/);
  assert.match(schema, /@@unique\(\[provider, providerEventId\]\)/);
});

test('billing repositories protect customer ownership and active subscription invariants', async () => {
  const customer = await readFile(new URL('../customer.repository.ts', import.meta.url), 'utf8');
  const subscription = await readFile(new URL('../subscription.repository.ts', import.meta.url), 'utf8');
  assert.match(customer, /studentId.*providerCustomerId|providerCustomerId.*studentId/);
  assert.match(customer, /CUSTOMER_STUDENT_MISMATCH/);
  assert.match(customer, /PROVIDER_CUSTOMER_ID_MISMATCH/);
  assert.match(subscription, /ACTIVE|TRIALING/);
  assert.match(subscription, /ACTIVE_SUBSCRIPTION_EXISTS/);
});

test('billing migration enforces domain checks and one active subscription per student', async () => {
  const migration = await readFile(new URL('../../../../../prisma/migrations/20260903000200_billing_integrity_fixes/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /billing_subscriptions_student_active_unique/);
  assert.match(migration, /student_enrollments_subscription_item_id.*SET NOT NULL|ALTER COLUMN "subscription_item_id" SET NOT NULL/);
  assert.match(migration, /billing_subscriptions_status_check/);
  assert.match(migration, /billing_interval/);
  assert.match(migration, /billing_webhook_events_status_check/);
});

test('billing webhook lifecycle permits the CLAIMED state used before processing', async () => {
  const migration = await readFile(new URL('../../../../../prisma/migrations/20260903000400_allow_claimed_webhook_status/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /billing_webhook_events_status_check/);
  assert.match(migration, /'CLAIMED'/);
});
