import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentSubscriptionService } from '../application/services/payment-subscription.service.js';

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_local_1',
    studentId: 'student_1',
    providerSubscriptionId: 'asaas_sub_1',
    environment: 'SANDBOX',
    status: 'ACTIVE',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-10-24T00:00:00.000Z'),
    items: [
      { id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 },
      { id: 'item_2', monitorId: 'monitor_2', status: 'ACTIVE', priceCentsSnapshot: 1990 },
    ],
    ...overrides,
  };
}

test('cancela somente o item solicitado e reduz o próximo valor quando existem outros itens', async () => {
  const calls: unknown[] = [];
  const invalidations: unknown[] = [];
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription(); },
    async updateItem(id, data) { calls.push(['item', id, data]); return data; },
    async updateSubscription(id, data) { calls.push(['subscription', id, data]); return data; },
    async createAudit(data) { calls.push(['audit', data]); },
  }, {
    async updateSubscription(input) { calls.push(['provider-update', input]); },
    async cancelSubscription() { throw new Error('não deve cancelar a assinatura inteira'); },
  }, async (studentId, reason) => { invalidations.push([studentId, reason]); });

  const result = await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-1');

  assert.equal(result.status, 'CANCEL_PENDING');
  assert.equal(result.endsAt, '2026-10-24T00:00:00.000Z');
  assert.deepEqual(calls[0], ['provider-update', {
    subscriptionId: 'asaas_sub_1',
    amount: 1990,
    interval: 'MONTHLY',
  }]);
  assert.deepEqual(calls[1], ['item', 'item_1', { status: 'CANCEL_PENDING' }]);
  assert.deepEqual(calls[2], ['audit', {
    actorUserId: 'req-1',
    studentId: 'student_1',
    subscriptionId: 'sub_local_1',
    monitorId: 'monitor_1',
    reason: 'STUDENT_REQUESTED_ITEM_CANCELLATION',
    endsAt: '2026-10-24T00:00:00.000Z',
  }]);
  assert.deepEqual(invalidations, [['student_1', 'STUDENT_REQUESTED_ITEM_CANCELLATION']]);
});

test('cancela a recorrência no Asaas quando o item solicitado é o último', async () => {
  const calls: unknown[] = [];
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async updateItem(id, data) { calls.push(['item', id, data]); return data; },
    async updateSubscription(id, data) { calls.push(['subscription', id, data]); return data; },
    async createAudit(data) { calls.push(['audit', data]); },
  }, {
    async updateSubscription() { throw new Error('não deve reduzir para zero'); },
    async cancelSubscription(input) { calls.push(['provider-delete', input]); },
  });

  await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-2');

  assert.deepEqual(calls[0], ['provider-delete', { subscriptionId: 'asaas_sub_1' }]);
  assert.deepEqual(calls[1], ['item', 'item_1', { status: 'CANCEL_PENDING' }]);
  assert.deepEqual(calls[2], ['subscription', 'sub_local_1', { status: 'CANCEL_PENDING', cancelAtPeriodEnd: true }]);
});

test('não permite cancelar assinatura que não pertence ao aluno autenticado', async () => {
  const service = new PaymentSubscriptionService({
    async findForStudent() { return null; },
    async updateItem() { throw new Error('não deve persistir'); },
    async updateSubscription() { throw new Error('não deve persistir'); },
    async createAudit() { throw new Error('não deve auditar'); },
  }, {
    async updateSubscription() { throw new Error('não deve chamar Asaas'); },
    async cancelSubscription() { throw new Error('não deve chamar Asaas'); },
  });

  await assert.rejects(() => service.cancelItem('student_2', 'sub_local_1', 'monitor_1', 'req-3'), { message: 'SUBSCRIPTION_NOT_FOUND' });
});

test('não repete a operação no Asaas quando a chave de idempotência já foi concluída', async () => {
  let providerCalls = 0;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return { state: 'COMPLETED' }; },
    async updateItem() { throw new Error('não deve persistir novamente'); },
    async updateSubscription() { throw new Error('não deve persistir novamente'); },
    async createAudit() { throw new Error('não deve auditar novamente'); },
  }, {
    async updateSubscription() { providerCalls += 1; },
    async cancelSubscription() { providerCalls += 1; },
  });

  const result = await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-4', 'idem-123');
  assert.equal(result.status, 'CANCEL_PENDING');
  assert.equal(providerCalls, 0);
});

test('libera retry quando o provedor falha depois de iniciar a idempotência', async () => {
  let state: string | null = null;
  let providerCalls = 0;
  let shouldFail = true;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription(); },
    async findIdempotency() { return state ? { state } : null; },
    async startIdempotency() { state = 'IN_PROGRESS'; },
    async failIdempotency() { state = 'FAILED'; },
    async completeIdempotency() { state = 'COMPLETED'; },
    async updateItem() { return undefined; },
    async updateSubscription() { return undefined; },
    async createAudit() { return undefined; },
  }, {
    async updateSubscription() {
      providerCalls += 1;
      if (shouldFail) {
        shouldFail = false;
        throw new Error('provider failure');
      }
    },
    async cancelSubscription() { providerCalls += 1; },
  });

  await assert.rejects(() => service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-5', 'idem-retry'));
  assert.equal(state, 'FAILED');
  await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-5', 'idem-retry');
  assert.equal(state, 'COMPLETED');
  assert.equal(providerCalls, 2);
});
