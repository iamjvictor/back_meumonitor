import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { SyncPaymentAccountWebhookUseCase } from '../modules/payments/application/commands/sync-payment-account-webhook.use-case.js';
import { LocalPaymentAccountCredentialStore } from '../modules/payments/infrastructure/credentials/payment-account-credential.store.js';
import { AsaasAccountProvider } from '../modules/payments/infrastructure/providers/asaas/asaas-account.provider.js';
import { getAsaasBaseUrl, selectAsaasApiKey } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';
import { AsaasHttpClient } from '../modules/payments/infrastructure/providers/asaas/asaas-http.client.js';
import { PaymentAccountRepository } from '../modules/payments/infrastructure/persistence/payment-account.repository.js';

const accountId = process.argv[2]?.trim();
if (!accountId) throw new Error('Uso: node --import tsx src/scripts/sync-asaas-subaccount-webhook.ts <paymentAccountId>');

const httpClient = new AsaasHttpClient({
  apiKey: selectAsaasApiKey(env.ASAAS_ENV, { sandbox: env.ASAAS_API_KEY_SANDBOX, production: env.ASAAS_API_KEY }) ?? '',
  baseUrl: getAsaasBaseUrl(env.ASAAS_ENV),
  environment: env.ASAAS_ENV,
  timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS,
});
const provider = new AsaasAccountProvider(httpClient, {
  webhookUrl: env.ASAAS_WEBHOOK_URL ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined),
  webhookEmail: env.ASAAS_WEBHOOK_EMAIL,
  webhookAuthToken: env.ASAAS_WEBHOOK_AUTH_TOKEN,
});
const credentialStore = new LocalPaymentAccountCredentialStore();
const useCase = new SyncPaymentAccountWebhookUseCase(new PaymentAccountRepository(credentialStore), credentialStore, provider);

try {
  const result = await useCase.execute(accountId, env.ASAAS_ENV.toUpperCase());
  console.log(JSON.stringify({ event: 'payments.asaas_subaccount_webhook_synced', ...result }, null, 2));
} finally {
  await prisma.$disconnect();
}
