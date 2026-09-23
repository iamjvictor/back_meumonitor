import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasWebhookIngress, WebhookAuthenticationError } from '../application/commands/accept-webhook.use-case.js';

const payload = {
  event: 'PAYMENT_CONFIRMED',
  payment: { id: 'pay_123', subscription: 'sub_123', value: 59.9 },
};

test('webhook Asaas rejeita token ausente ou incorreto', async () => {
  const ingress = new AsaasWebhookIngress({
    accessToken: 'a'.repeat(32),
    inbox: { async accept() { throw new Error('não deveria persistir'); } },
  });

  await assert.rejects(() => ingress.accept({ token: undefined, payload }), WebhookAuthenticationError);
  await assert.rejects(() => ingress.accept({ token: 'b'.repeat(32), payload }), WebhookAuthenticationError);
});

test('webhook Asaas persiste evento válido e replay retorna o mesmo evento', async () => {
  const events: Array<{ providerEventId: string; eventType: string; payload: unknown }> = [];
  const ingress = new AsaasWebhookIngress({
    accessToken: 'a'.repeat(32),
    inbox: {
      async accept(input) {
        const existing = events.find((event) => event.providerEventId === input.providerEventId);
        if (existing) return { id: 'event_1', duplicate: true, state: 'RECEIVED' };
        events.push(input);
        return { id: 'event_1', duplicate: false, state: 'RECEIVED' };
      },
    },
  });

  const first = await ingress.accept({ token: 'a'.repeat(32), payload });
  const replay = await ingress.accept({ token: 'a'.repeat(32), payload });

  assert.deepEqual(first, { accepted: true, duplicate: false, eventId: 'event_1' });
  assert.deepEqual(replay, { accepted: true, duplicate: true, eventId: 'event_1' });
  assert.equal(events[0]?.eventType, 'PAYMENT_CONFIRMED');
});

test('webhook Asaas exige identificador externo do evento', async () => {
  const ingress = new AsaasWebhookIngress({
    accessToken: 'a'.repeat(32),
    inbox: { async accept() { throw new Error('não deveria persistir'); } },
  });

  await assert.rejects(
    () => ingress.accept({ token: 'a'.repeat(32), payload: { event: 'PAYMENT_CONFIRMED' } }),
    /provider event id/i,
  );
});

test('webhook Asaas extrai o id da subconta do payload quando o header não existe', async () => {
  let receivedAccountId: string | undefined;
  const ingress = new AsaasWebhookIngress({
    accessToken: 'a'.repeat(32),
    inbox: {
      async accept(input) {
        receivedAccountId = input.providerAccountId;
        return { id: 'event_account', duplicate: false, state: 'RECEIVED' };
      },
    },
  });

  await ingress.accept({
    token: 'a'.repeat(32),
    payload: {
      id: 'evt_account_1',
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
      account: { id: 'asaas_subaccount_123', ownerId: 'asaas_parent_123' },
    },
  });

  assert.equal(receivedAccountId, 'asaas_subaccount_123');
});
