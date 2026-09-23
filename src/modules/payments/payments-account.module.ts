import { env } from '../../config/env.js';
import { getAsaasBaseUrl } from './infrastructure/providers/asaas/asaas.config.js';
import { AsaasAccountProvider } from './infrastructure/providers/asaas/asaas-account.provider.js';
import { AsaasHttpClient } from './infrastructure/providers/asaas/asaas-http.client.js';
import { PaymentAccountRepository } from './infrastructure/persistence/payment-account.repository.js';
import { StartPaymentAccountUseCase } from './application/commands/start-payment-account.use-case.js';
import { GetPaymentAccountUseCase } from './application/queries/get-payment-account.use-case.js';
import { PaymentAccountController } from './http/payment-account.controller.js';

export function createPaymentAccountModule() {
  const httpClient = new AsaasHttpClient({ apiKey: env.ASAAS_API_KEY ?? '', baseUrl: getAsaasBaseUrl(env.ASAAS_ENV), timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS });
  const provider = new AsaasAccountProvider(httpClient, {
    webhookUrl: env.ASAAS_WEBHOOK_URL ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined),
    webhookEmail: env.ASAAS_WEBHOOK_EMAIL,
    webhookAuthToken: env.ASAAS_WEBHOOK_AUTH_TOKEN,
  });
  const repository = new PaymentAccountRepository();
  const startAccount = new StartPaymentAccountUseCase(repository, provider);
  const getAccount = new GetPaymentAccountUseCase(repository);
  const controller = new PaymentAccountController(getAccount, startAccount);
  return { repository, provider, startAccount, getAccount, controller };
}
