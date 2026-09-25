import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPaymentOrderHistory, mapSubscriptionCancellationHistory } from '../payment-history.mapper.js';

test('maps a confirmed Asaas charge to a paid student history entry', () => {
  const result = mapPaymentOrderHistory({
    id: 'order-1',
    status: 'PAYMENT_CONFIRMED',
    grossCents: 1990,
    currency: 'BRL',
    createdAt: new Date('2026-09-22T12:00:00.000Z'),
    items: [{ descriptionSnapshot: 'Monitor de Matemática' }],
    checkouts: [{ providerCheckoutId: 'checkout-1' }],
    subscription: {
      charges: [{
        id: 'charge-1',
        status: 'CONFIRMED',
        grossCents: 1990,
        providerCheckoutId: 'checkout-1',
        confirmedAt: new Date('2026-09-22T12:05:00.000Z'),
        receivedAt: null,
        createdAt: new Date('2026-09-22T12:00:00.000Z'),
      }],
    },
  });

  assert.deepEqual(result, [{
    id: 'charge-1',
    status: 'PAID',
    paymentMethod: 'OTHER',
    currency: 'BRL',
    totalAmount: 1990,
    gatewayCheckoutId: 'checkout-1',
    createdAt: new Date('2026-09-22T12:05:00.000Z'),
    items: [{ descriptionSnapshot: 'Monitor de Matemática', quantity: 1 }],
    source: 'ASAAS',
  }]);
});

test('keeps a pending Asaas order visible when no charge exists yet', () => {
  const result = mapPaymentOrderHistory({
    id: 'order-2',
    status: 'PENDING',
    grossCents: 5990,
    currency: 'BRL',
    createdAt: new Date('2026-09-24T12:00:00.000Z'),
    items: [{ descriptionSnapshot: 'Monitor de Física' }],
    checkouts: [{ providerCheckoutId: null }],
    subscription: { charges: [] },
  });

  assert.equal(result[0]?.id, 'order-2');
  assert.equal(result[0]?.status, 'PENDING');
  assert.equal(result[0]?.totalAmount, 5990);
});

test('maps a cancellation audit entry to a cancelled history row', () => {
  const result = mapSubscriptionCancellationHistory({
    id: 'audit-1',
    monitorId: 'monitor-1',
    monitorName: 'Monitor de Matemática',
    createdAt: new Date('2026-09-25T12:00:00.000Z'),
    source: 'ASAAS',
  });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.totalAmount, null);
  assert.equal(result.items[0]?.descriptionSnapshot, 'Monitor de Matemática');
});
