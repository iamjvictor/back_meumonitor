import assert from 'node:assert/strict';
import test from 'node:test';
import { AsaasPaymentProvider } from '../asaas-payment.provider.js';
import { SimulatedPaymentProvider } from '../simulated-payment.provider.js';

test('remove a recorrência no Asaas sem enviar corpo', async () => {
  const calls: Array<{ path: string; request: { method: string; body?: unknown } }> = [];
  const provider = new AsaasPaymentProvider({
    async request<T>(path: string, request: { method: 'DELETE' | 'PUT'; body?: unknown }) {
      calls.push({ path, request });
      return undefined as T;
    },
  }, new SimulatedPaymentProvider());

  await provider.cancelSubscription({ subscriptionId: 'sub_asaas_123', atPeriodEnd: true });

  assert.deepEqual(calls, [{ path: '/subscriptions/sub_asaas_123', request: { method: 'DELETE' } }]);
});

test('atualiza o valor futuro da recorrência no Asaas ao remover um monitor', async () => {
  const calls: Array<{ path: string; request: { method: string; body?: unknown } }> = [];
  const provider = new AsaasPaymentProvider({
    async request<T>(path: string, request: { method: 'DELETE' | 'PUT'; body?: unknown }) {
      calls.push({ path, request });
      return undefined as T;
    },
  }, new SimulatedPaymentProvider());

  await provider.updateSubscription({ subscriptionId: 'sub_asaas_123', amount: 1990, interval: 'MONTH', effectiveAt: 'PERIOD_END' });

  assert.deepEqual(calls, [{
    path: '/subscriptions/sub_asaas_123',
    request: { method: 'PUT', body: { value: 19.9, cycle: 'MONTHLY', updatePendingPayments: false } },
  }]);
});
