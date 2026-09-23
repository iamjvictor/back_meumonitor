import { AsaasCheckoutProvider } from './infrastructure/providers/asaas/asaas-checkout.provider.js';
import { AsaasHttpClient } from './infrastructure/providers/asaas/asaas-http.client.js';
import { PaymentsClient } from './application/payments-client.js';

export type PaymentsModuleConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

export function createPaymentsModule(config: PaymentsModuleConfig) {
  const httpClient = new AsaasHttpClient(config);
  const checkoutProvider = new AsaasCheckoutProvider(httpClient);
  const paymentsClient = new PaymentsClient(checkoutProvider);

  return { httpClient, checkoutProvider, paymentsClient };
}
