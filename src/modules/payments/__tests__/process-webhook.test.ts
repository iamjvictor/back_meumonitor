import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessPaymentWebhookUseCase } from '../application/commands/process-webhook.use-case.js';

function repositoryFor(event: Record<string, unknown>, calls: string[]) {
  return {
    async claim() { return event; },
    async markWaitingCorrelation() { calls.push('waiting'); },
    async markProcessed(_eventId: string, state: string) { calls.push(`processed:${state}`); },
  } as never;
}

test('webhook de status aguarda correlação quando a conta local ainda não existe', async () => {
  const calls: string[] = [];
  const accounts = {
    async applyAccountStatusEvent() { return { count: 0 }; },
  } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_1',
    eventType: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    providerAccountId: 'asaas_subaccount_123',
    payload: { account: { id: 'asaas_subaccount_123' } },
    createdAt: new Date(),
  }, calls), accounts);

  const result = await useCase.execute('event_1');

  assert.deepEqual(result, { skipped: false, state: 'WAITING_CORRELATION' });
  assert.deepEqual(calls, ['waiting']);
});

test('webhook de status só é concluído quando a conta local foi atualizada', async () => {
  const calls: string[] = [];
  const accounts = {
    async applyAccountStatusEvent() { return { count: 1 }; },
  } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_2',
    eventType: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    providerAccountId: 'asaas_subaccount_123',
    payload: { account: { id: 'asaas_subaccount_123' } },
    createdAt: new Date(),
  }, calls), accounts);

  const result = await useCase.execute('event_2');

  assert.deepEqual(result, { skipped: false, state: 'ACCOUNT_STATUS_APPLIED' });
  assert.deepEqual(calls, ['processed:ACCOUNT_STATUS_APPLIED']);
});

test('pagamento confirmado processa acesso e marca evento como aplicado', async () => {
  const calls: string[] = [];
  const payments = {
    async applyPaymentEvent(input: { eventType: string }) {
      assert.equal(input.eventType, 'PAYMENT_CONFIRMED');
      return { updatedRows: 1, chargeId: 'charge_1', studentId: 'student_1', monitorId: 'monitor_1', accessGranted: true };
    },
  } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_payment_1',
    eventType: 'PAYMENT_CONFIRMED',
    providerAccountId: 'parent_1',
    payload: { payment: { id: 'pay_1', externalReference: 'order_1' } },
    createdAt: new Date(),
    environment: 'SANDBOX',
  }, calls), undefined, payments);

  const result = await useCase.execute('event_payment_1');

  assert.deepEqual(result, { skipped: false, state: 'PAYMENT_ACCESS_APPLIED' });
  assert.deepEqual(calls, ['processed:PAYMENT_ACCESS_APPLIED']);
});

test('pagamento sem pedido correspondente permanece aguardando correlação', async () => {
  const calls: string[] = [];
  const payments = { async applyPaymentEvent() { return { updatedRows: 0, accessGranted: false }; } } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_payment_2',
    eventType: 'PAYMENT_CONFIRMED',
    payload: { payment: { id: 'pay_unknown' } },
    createdAt: new Date(),
    environment: 'SANDBOX',
  }, calls), undefined, payments);

  const result = await useCase.execute('event_payment_2');

  assert.deepEqual(result, { skipped: false, state: 'WAITING_CORRELATION' });
  assert.deepEqual(calls, ['waiting']);
});

test('cancelamento de assinatura é aplicado localmente e não fica aguardando correlação', async () => {
  const calls: string[] = [];
  const payments = {
    async applySubscriptionEvent(input: { eventType: string; environment: string }) {
      assert.equal(input.eventType, 'SUBSCRIPTION_DELETED');
      assert.equal(input.environment, 'SANDBOX');
      return { updatedRows: 1 };
    },
  } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_subscription_deleted',
    eventType: 'SUBSCRIPTION_DELETED',
    payload: { subscription: { id: 'asaas_sub_1' } },
    createdAt: new Date(),
    environment: 'SANDBOX',
  }, calls), undefined, payments);

  const result = await useCase.execute('event_subscription_deleted');

  assert.deepEqual(result, { skipped: false, state: 'SUBSCRIPTION_STATE_APPLIED' });
  assert.deepEqual(calls, ['processed:SUBSCRIPTION_STATE_APPLIED']);
});

test('evento de split efetivo é encaminhado para reconciliação financeira', async () => {
  const calls: string[] = [];
  const payments = {
    async applyPaymentEvent(input: { eventType: string; environment: string }) {
      assert.equal(input.eventType, 'PAYMENT_SPLIT_DONE');
      assert.equal(input.environment, 'SANDBOX');
      return { updatedRows: 1, chargeId: 'charge_1', accessGranted: false };
    },
  } as never;
  const useCase = new ProcessPaymentWebhookUseCase(repositoryFor({
    id: 'event_split_done',
    eventType: 'PAYMENT_SPLIT_DONE',
    payload: { payment: { id: 'pay_1', externalReference: 'order_1', splits: [{ id: 'split_1', walletId: 'wallet_1', totalValue: 14.95 }] } },
    createdAt: new Date(),
    environment: 'SANDBOX',
  }, calls), undefined, payments);

  const result = await useCase.execute('event_split_done');

  assert.deepEqual(result, { skipped: false, state: 'PAYMENT_ACCESS_APPLIED' });
  assert.deepEqual(calls, ['processed:PAYMENT_ACCESS_APPLIED']);
});
