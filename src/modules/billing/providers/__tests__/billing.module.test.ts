import assert from 'node:assert/strict';
import test from 'node:test';
import { createBillingModule } from '../../billing.module.js';
import { AsaasPaymentProvider } from '../asaas-payment.provider.js';

test('usa o provider Asaas quando o billing está configurado para ASAAS', () => {
  const module = createBillingModule({
    simulationEnabled: false,
    testPriceCents: 1990,
    paymentProvider: 'ASAAS',
    asaasApiKey: 'test-key',
    asaasBaseUrl: 'https://api-sandbox.asaas.com/v3',
    asaasTimeoutMs: 1000,
  });

  assert.ok(module.provider instanceof AsaasPaymentProvider);
});
