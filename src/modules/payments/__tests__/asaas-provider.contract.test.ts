import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasCheckoutProvider } from '../infrastructure/providers/asaas/asaas-checkout.provider.js';

test('provider cria checkout hospedado mensal de cartão com snapshots e split', async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const provider = new AsaasCheckoutProvider({
    async request<T>(path: string, options: { method: 'POST'; body: unknown }) {
      calls.push({ path, options });
      return { id: 'co_123', url: 'https://sandbox.asaas.com/checkout/co_123', expiresAt: '2026-10-01T00:00:00.000Z' } as T;
    },
  });

  const result = await provider.createHostedCheckout({
    externalReference: 'order-123',
    customerId: 'cus_123',
    monitorName: 'Monitor Matemática',
    description: 'Acesso mensal',
    amountCents: 5990,
    successUrl: 'https://app.test/checkout/retorno?status=success',
    cancelUrl: 'https://app.test/checkout/retorno?status=cancelled',
    expiredUrl: 'https://app.test/checkout/retorno?status=expired',
    nextDueDate: '2026-09-23',
    splits: [{ walletId: 'wal_teacher', percentage: '50.0000' }],
  });

  assert.deepEqual(result, {
    providerCheckoutId: 'co_123',
    checkoutUrl: 'https://sandbox.asaas.com/checkout/co_123',
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
  });
  assert.equal(calls[0]?.path, '/checkouts');
  assert.deepEqual(calls[0]?.options, {
    method: 'POST',
    body: {
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      externalReference: 'order-123',
      customer: 'cus_123',
      items: [{ name: 'Monitor Matemática', description: 'Acesso mensal', quantity: 1, value: 59.9 }],
      subscription: { cycle: 'MONTHLY', nextDueDate: '2026-09-23' },
      callback: {
        successUrl: 'https://app.test/checkout/retorno?status=success',
        cancelUrl: 'https://app.test/checkout/retorno?status=cancelled',
        expiredUrl: 'https://app.test/checkout/retorno?status=expired',
        autoRedirect: true,
      },
      splits: [{ walletId: 'wal_teacher', percentageValue: 50 }],
    },
  });
});

test('provider normaliza link retornado pelo Asaas', async () => {
  const provider = new AsaasCheckoutProvider({
    async request<T>() {
      return { id: 'co_link', link: 'https://sandbox.asaas.com/checkoutSession/show/co_link' } as T;
    },
  });

  const result = await provider.createHostedCheckout({
    externalReference: 'order-link', monitorName: 'Monitor', description: 'Assinatura', amountCents: 5990,
    successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel', expiredUrl: 'https://app.test/expired',
    nextDueDate: '2026-09-23', splits: [],
  });

  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkoutSession/show/co_link');
});

test('provider monta link sandbox a partir do ID quando a API não retorna link', async () => {
  const provider = new AsaasCheckoutProvider({ async request<T>() { return { id: 'co_sandbox' } as T; } }, 'sandbox');
  const result = await provider.createHostedCheckout({
    externalReference: 'order-sandbox', monitorName: 'Monitor', description: 'Assinatura', amountCents: 5990,
    successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel', expiredUrl: 'https://app.test/expired',
    nextDueDate: '2026-09-23', splits: [],
  });
  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkoutSession/show/co_sandbox');
});
