import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionController } from '../subscription.controller.js';

function reply() {
  return { statusCode: 200, payload: undefined as any, code(value: number) { this.statusCode = value; return this; }, send(value: unknown) { this.payload = value; return this; }, };
}

test('subscription controller rejects unauthenticated requests', async () => {
  const controller = new SubscriptionController({}, {});
  const response = reply();
  await controller.list({ id: 'r1', user: null } as any, response as any);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, 'UNAUTHENTICATED');
});

test('subscription controller rejects invalid body and missing idempotency key', async () => {
  const service = { addMonitor: async () => { throw new Error('must not run'); } };
  const controller = new SubscriptionController(service, {});
  const response = reply();
  await controller.add({ id: 'r2', user: { id: 'user-1' }, headers: {}, params: { subscriptionId: 'not-uuid' }, body: { monitorId: 'not-uuid' } } as any, response as any);
  assert.equal(response.statusCode, 422);
  assert.equal(response.payload.error, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('subscription controller passes authenticated user and idempotency key to add', async () => {
  let received: unknown[] = [];
  const service = { addMonitor: async (...args: unknown[]) => { received = args; return { subscriptionId: 'sub-1', status: 'ACTIVE', amount: 1990 }; } };
  const controller = new SubscriptionController(service, {});
  const response = reply();
  await controller.add({ id: 'r3', user: { id: 'user-1' }, headers: { 'idempotency-key': 'operation-123' }, params: { subscriptionId: '06552fe3-9d29-498f-8281-5de1beda93aa' }, body: { monitorId: '06552fe3-9d29-498f-8281-5de1beda93aa' } } as any, response as any);
  assert.deepEqual(received, ['user-1', '06552fe3-9d29-498f-8281-5de1beda93aa', '06552fe3-9d29-498f-8281-5de1beda93aa', 'operation-123']);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.status, 'ACTIVE');
});

test('subscription controller maps ownership failure without leaking internals', async () => {
  const controller = new SubscriptionController({ cancel: async () => { throw new Error('SUBSCRIPTION_NOT_FOUND'); } }, {});
  const response = reply();
  await controller.cancel({ id: 'r4', user: { id: 'user-1' }, headers: { 'idempotency-key': 'operation-456' }, params: { subscriptionId: '06552fe3-9d29-498f-8281-5de1beda93aa' } } as any, response as any);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.error, 'SUBSCRIPTION_NOT_FOUND');
  assert.equal(response.payload.message, 'Não foi possível processar a assinatura.');
});

test('subscription controller lista o histórico de alterações do aluno', async () => {
  const controller = new SubscriptionController({}, {
    findChangesForUser: async (userId: string) => [{ id: 'change-1', userId }],
  });
  const response = reply();
  await controller.history({ id: 'r5', user: { id: 'user-1' } } as any, response as any);
  assert.deepEqual(response.payload, { data: [{ id: 'change-1', userId: 'user-1' }] });
});
