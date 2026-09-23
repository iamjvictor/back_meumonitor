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
