import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhookController } from '../webhook.controller.js';
import { AppError } from '../../../../core/errors/app-error.js';

function reply() {
  const result: any = { code: 200, body: undefined };
  result.code = (status: number) => { result.status = status; return result; };
  result.send = (body: unknown) => { result.body = body; return result; };
  return result;
}

test('rejeita body inválido sem chamar o service', async () => {
  let calls = 0;
  const controller = new WebhookController({ process: async () => { calls++; } } as any);
  await assert.rejects(
    controller.process({ params: { provider: 'SIMULATED' }, body: { providerEventId: '', amount: -1 } } as any, reply()),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR' && error.statusCode === 422,
  );
  assert.equal(calls, 0);
});

test('remove campos sensíveis antes de encaminhar payload ao service', async () => {
  let received: any;
  const controller = new WebhookController({ process: async (_provider: string, event: any) => { received = event; return { status: 'PROCESSED' }; } } as any);
  await controller.process({ params: { provider: 'SIMULATED' }, body: { providerEventId: 'evt-1', type: 'checkout.completed', purchaseId: '11111111-1111-4111-8111-111111111111', amount: 1990, currency: 'BRL', payload: { card: 'secret', token: 'secret', safe: 'ok' } } } as any, reply());
  assert.equal(received.payload.safe, 'ok');
  assert.equal(received.payload.card, undefined);
  assert.equal(received.payload.token, undefined);
});

test('Stripe falha fechado sem verificação configurada', async () => {
  let calls = 0;
  const controller = new WebhookController({ process: async () => { calls++; } } as any);
  await assert.rejects(
    controller.process({ params: { provider: 'STRIPE' }, body: { providerEventId: 'evt-1', type: 'checkout.completed', purchaseId: '11111111-1111-4111-8111-111111111111', amount: 1990, currency: 'BRL' } } as any, reply()),
    (error: unknown) => error instanceof AppError && error.code === 'STRIPE_WEBHOOK_NOT_CONFIGURED' && error.statusCode === 503,
  );
  assert.equal(calls, 0);
});
