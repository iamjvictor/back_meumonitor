import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulatedPaymentProvider } from '../simulated-payment.provider.js';

test('creates a deterministic customer and an aggregate simulated checkout', async () => {
  const provider = new SimulatedPaymentProvider();
  const first = await provider.getOrCreateCustomer({ studentId: 'student-1', email: 'student@example.com' });
  const second = await provider.getOrCreateCustomer({ studentId: 'student-1', email: 'changed@example.com' });
  assert.deepEqual(first, second);

  const checkout = await provider.createCheckout({ customerId: first.customerId, purchaseId: 'purchase-1', amount: 4990, currency: 'BRL', interval: 'MONTH' });
  assert.match(checkout.checkoutId, /^sim_checkout_/);
  assert.equal(checkout.checkoutUrl, '/checkout/simulado');
  assert.ok(checkout.expiresAt.getTime() > Date.now());
  assert.deepEqual(await provider.createCheckout({ customerId: first.customerId, purchaseId: 'purchase-1', amount: 1, currency: 'USD', interval: 'YEAR' }), checkout);
});

test('records immediate and end-of-period subscription changes safely', async () => {
  const provider = new SimulatedPaymentProvider();
  await provider.updateSubscription({ subscriptionId: 'sub-1', amount: 5990, interval: 'YEAR', effectiveAt: 'PERIOD_END' });
  await provider.updateSubscription({ subscriptionId: 'sub-1', amount: 5990, interval: 'YEAR', effectiveAt: 'PERIOD_END' });
  await provider.cancelSubscription({ subscriptionId: 'sub-1', atPeriodEnd: true });
  await provider.cancelSubscription({ subscriptionId: 'sub-1', atPeriodEnd: true });
  await provider.cancelSubscription({ subscriptionId: 'sub-2', atPeriodEnd: false });
});
