import { env } from '../../config/env.js';
import { getAsaasBaseUrl } from './infrastructure/providers/asaas/asaas.config.js';
import { AsaasAccountProvider } from './infrastructure/providers/asaas/asaas-account.provider.js';
import { AsaasHttpClient } from './infrastructure/providers/asaas/asaas-http.client.js';
import { PaymentAccountRepository } from './infrastructure/persistence/payment-account.repository.js';
import { StartPaymentAccountUseCase } from './application/commands/start-payment-account.use-case.js';
import { GetPaymentAccountUseCase } from './application/queries/get-payment-account.use-case.js';
import { PaymentAccountController } from './http/payment-account.controller.js';
import { AsaasAccountOverviewProvider } from './infrastructure/providers/asaas/asaas-account-overview.provider.js';
import { GetPaymentAccountOverviewUseCase } from './application/queries/get-payment-account-overview.use-case.js';
import { LocalPaymentAccountCredentialStore } from './infrastructure/credentials/payment-account-credential.store.js';
import { createPaymentAccountCredentialResolver } from './application/queries/get-payment-account-overview.use-case.js';
import { RotatePaymentAccountCredentialUseCase } from './application/commands/rotate-payment-account-credential.use-case.js';

export function createPaymentAccountModule() {
  const httpClient = new AsaasHttpClient({ apiKey: env.ASAAS_API_KEY ?? '', baseUrl: getAsaasBaseUrl(env.ASAAS_ENV), environment: env.ASAAS_ENV, timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS });
  const provider = new AsaasAccountProvider(httpClient, {
    webhookUrl: env.ASAAS_WEBHOOK_URL ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined),
    webhookEmail: env.ASAAS_WEBHOOK_EMAIL,
    webhookAuthToken: env.ASAAS_WEBHOOK_AUTH_TOKEN,
  });
  const credentialStore = new LocalPaymentAccountCredentialStore();
  const repository = new PaymentAccountRepository(credentialStore);
  const rotateCredential = new RotatePaymentAccountCredentialUseCase(repository, credentialStore);
  const startAccount = new StartPaymentAccountUseCase(repository, provider);
  const getAccount = new GetPaymentAccountUseCase(repository);
  const overviewProvider = new AsaasAccountOverviewProvider(httpClient, {
    environment: env.ASAAS_ENV,
    logger: (entry) => console.log('Resposta do overview financeiro Asaas', {
      ...entry,
      environment: env.ASAAS_ENV,
    }),
  });
  const getOverview = new GetPaymentAccountOverviewUseCase(repository, overviewProvider, {
    dashboardUrl: resolveAsaasDashboardUrl(env.ASAAS_ENV, env.ASAAS_DASHBOARD_URL),
    resolveCredential: createPaymentAccountCredentialResolver(repository, credentialStore, env.ASAAS_ENV),
    logger: (entry) => console.log('Diagnóstico do overview da conta', {
      ...entry,
      environment: env.ASAAS_ENV,
    }),
  });
  const controller = new PaymentAccountController(getAccount, startAccount, getOverview);
  return { repository, provider, startAccount, getAccount, overviewProvider, getOverview, controller, rotateCredential };
}

function resolveAsaasDashboardUrl(environment: 'sandbox' | 'production', configuredUrl: string): string {
  // O sandbox possui autenticação e painel separados do ambiente de produção.
  // Mantemos override explícito, mas corrigimos o default legado de produção.
  if (environment === 'sandbox' && configuredUrl === 'https://www.asaas.com/login') return 'https://sandbox.asaas.com/login';
  return configuredUrl;
}
