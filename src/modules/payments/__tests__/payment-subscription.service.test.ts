import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentSubscriptionProviderError, PaymentSubscriptionReconciliationError, PaymentSubscriptionService } from '../application/services/payment-subscription.service.js';

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
    async finalizeCancellation(input) { calls.push(['finalize', input]); },
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
  assert.deepEqual(calls[1], ['finalize', {
    itemId: 'item_1',
    studentId: 'student_1',
    subscriptionId: 'sub_local_1',
    monitorId: 'monitor_1',
    actorUserId: 'req-1',
    cancelEntireSubscription: false,
    endsAt: '2026-10-24T00:00:00.000Z',
  }]);
  assert.deepEqual(invalidations, [['student_1', 'STUDENT_REQUESTED_ITEM_CANCELLATION']]);
});

test('cancela a recorrência no Asaas quando o item solicitado é o último', async () => {
  const calls: unknown[] = [];
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async finalizeCancellation(input) { calls.push(['finalize', input]); },
  }, {
    async updateSubscription() { throw new Error('não deve reduzir para zero'); },
    async cancelSubscription(input) { calls.push(['provider-delete', input]); },
  });

  await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-2');

  assert.deepEqual(calls[0], ['provider-delete', { subscriptionId: 'asaas_sub_1' }]);
  assert.deepEqual(calls[1], ['finalize', {
    itemId: 'item_1',
    studentId: 'student_1',
    subscriptionId: 'sub_local_1',
    monitorId: 'monitor_1',
    actorUserId: 'req-2',
    cancelEntireSubscription: true,
    endsAt: '2026-10-24T00:00:00.000Z',
  }]);
});

test('não permite cancelar assinatura que não pertence ao aluno autenticado', async () => {
  const service = new PaymentSubscriptionService({
    async findForStudent() { return null; },
    async finalizeCancellation() { throw new Error('não deve persistir'); },
  }, {
    async updateSubscription() { throw new Error('não deve chamar Asaas'); },
    async cancelSubscription() { throw new Error('não deve chamar Asaas'); },
  });

  await assert.rejects(() => service.cancelItem('student_2', 'sub_local_1', 'monitor_1', 'req-3'), { message: 'SUBSCRIPTION_NOT_FOUND' });
});

test('não reserva idempotência quando o item não é cancelável', async () => {
  let idempotencyStarted = false;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'CANCEL_PENDING', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return null; },
    async startIdempotency() { idempotencyStarted = true; },
    async finalizeCancellation() { throw new Error('não deve persistir'); },
  }, {
    async updateSubscription() { throw new Error('não deve chamar Asaas'); },
    async cancelSubscription() { throw new Error('não deve chamar Asaas'); },
  });

  await assert.rejects(() => service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-invalid', 'idem-invalid'), { message: 'SUBSCRIPTION_ITEM_NOT_FOUND' });

  assert.equal(idempotencyStarted, false);
});

test('não repete a operação no Asaas quando a chave de idempotência já foi concluída', async () => {
  let providerCalls = 0;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return { state: 'COMPLETED' }; },
    async finalizeCancellation() { throw new Error('não deve persistir novamente'); },
  }, {
    async updateSubscription() { providerCalls += 1; },
    async cancelSubscription() { providerCalls += 1; },
  });

  const result = await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-4', 'idem-123');
  assert.equal(result.status, 'CANCEL_PENDING');
  assert.equal(providerCalls, 0);
});

test('rejeita chave de idempotência já vinculada a outra assinatura', async () => {
  let providerCalls = 0;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ id: 'sub_local_1', items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return { state: 'COMPLETED', resourceId: 'sub_local_outra' }; },
    async finalizeCancellation() { throw new Error('não deve persistir'); },
  }, {
    async updateSubscription() { providerCalls += 1; },
    async cancelSubscription() { providerCalls += 1; },
  });

  await assert.rejects(
    () => service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-reused-key', 'idem-reused-key'),
    { message: 'IDEMPOTENCY_KEY_REUSED' },
  );
  assert.equal(providerCalls, 0);
});

test('libera retry quando o provedor falha depois de iniciar a idempotência', async () => {
  let state: string | null = null;
  let providerCalls = 0;
  let restartCalls = 0;
  let shouldFail = true;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription(); },
    async findIdempotency() { return state ? { state } : null; },
    async startIdempotency() {
      if (state) throw new Error('IDEMPOTENCY_KEY_ALREADY_EXISTS');
      state = 'IN_PROGRESS';
    },
    async restartFailedIdempotency() {
      restartCalls += 1;
      if (state !== 'FAILED') return false;
      state = 'IN_PROGRESS';
      return true;
    },
    async failIdempotency() { state = 'FAILED'; },
    async markProviderCancellationConfirmed() { state = 'PROVIDER_CONFIRMED'; },
    async finalizeCancellation() { state = 'COMPLETED'; },
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
  assert.equal(restartCalls, 1);
});

test('finaliza localmente sem repetir o Asaas quando o provedor já confirmou o cancelamento', async () => {
  let state: string | null = 'PROVIDER_CONFIRMED';
  let providerCalls = 0;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return state ? { state } : null; },
    async startIdempotency() { throw new Error('não deve recriar a chave'); },
    async finalizeCancellation() { state = 'COMPLETED'; },
  }, {
    async updateSubscription() { providerCalls += 1; },
    async cancelSubscription() { providerCalls += 1; },
  });

  const result = await service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-7', 'idem-provider-confirmed');

  assert.equal(result.status, 'CANCEL_PENDING');
  assert.equal(providerCalls, 0);
  assert.equal(state, 'COMPLETED');
});

test('não marca a operação como falha do provedor depois que o Asaas confirmou', async () => {
  let markedFailed = false;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return null; },
    async startIdempotency() { return undefined; },
    async markProviderCancellationConfirmed() { throw new Error('banco indisponível'); },
    async failIdempotency() { markedFailed = true; },
    async finalizeCancellation() { throw new Error('não deve finalizar'); },
  }, {
    async updateSubscription() { return undefined; },
    async cancelSubscription() { return undefined; },
  });

  await assert.rejects(
    () => service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-8', 'idem-confirmation-persist-failure'),
    PaymentSubscriptionReconciliationError,
  );

  assert.equal(markedFailed, false);
});

test('não altera item, assinatura ou auditoria local quando o Asaas rejeita o cancelamento', async () => {
  const localMutations: string[] = [];
  let idempotencyState: string | null = null;
  const service = new PaymentSubscriptionService({
    async findForStudent() { return makeSubscription({ items: [{ id: 'item_1', monitorId: 'monitor_1', status: 'ACTIVE', priceCentsSnapshot: 2990 }] }); },
    async findIdempotency() { return idempotencyState ? { state: idempotencyState } : null; },
    async startIdempotency() { idempotencyState = 'IN_PROGRESS'; },
    async failIdempotency() { idempotencyState = 'FAILED'; },
    async finalizeCancellation() { localMutations.push('finalize'); },
  }, {
    async updateSubscription() { throw new Error('Asaas indisponível'); },
    async cancelSubscription() { throw new Error('Asaas indisponível'); },
  });

  await assert.rejects(
    () => service.cancelItem('student_1', 'sub_local_1', 'monitor_1', 'req-6', 'idem-provider-failure'),
    PaymentSubscriptionProviderError,
  );

  assert.deepEqual(localMutations, []);
  assert.equal(idempotencyState, 'FAILED');
});
