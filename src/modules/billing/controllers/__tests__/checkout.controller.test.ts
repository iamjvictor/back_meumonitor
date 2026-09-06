import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckoutController } from '../checkout.controller.js';

test('registra e devolve purchaseId quando o checkout agregado é criado', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const originalLog = console.log;
  console.log = ((_: unknown, payload: Record<string, unknown>) => { logs.push(payload); }) as typeof console.log;
  const sent: { status?: number; body?: any } = {};
  const reply = {
    code(status: number) { sent.status = status; return this; },
    send(body: unknown) { sent.body = body; return this; },
  };
  try {
    const controller = new CheckoutController({
      createPurchase: async () => ({ purchaseId: 'purchase-1', status: 'PENDING', checkoutUrl: '/checkout/simulado', sessionId: 'session-1' }),
    } as any);
    await controller.create({ id: 'req-1', user: { id: 'user-1' }, headers: { 'idempotency-key': 'key-123456' }, body: { monitorIds: ['11111111-1111-4111-8111-111111111111'], paymentMethod: 'PIX' } } as any, reply as any);
  } finally {
    console.log = originalLog;
  }
  assert.equal(sent.status, 201);
  assert.equal(sent.body.data.purchaseId, 'purchase-1');
  const completed = logs.find((entry) => entry.event === 'monitor.student_purchase_http_create_completed');
  assert.equal(completed?.purchaseId, 'purchase-1');
  assert.equal(completed?.status, 'PENDING');
});
