import { env } from '../config/env.js';
import { getAsaasBaseUrl } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';

const webhookUrl = env.ASAAS_WEBHOOK_URL ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined);
const webhookEmail = process.env.ASAAS_WEBHOOK_EMAIL;
const authToken = env.ASAAS_WEBHOOK_AUTH_TOKEN;

if (!webhookUrl) throw new Error('Defina ASAAS_WEBHOOK_URL ou PUBLIC_API_URL antes de registrar o webhook.');
if (!webhookEmail) throw new Error('Defina ASAAS_WEBHOOK_EMAIL com o e-mail de alertas da conta principal do Asaas.');
if (!authToken) throw new Error('Defina ASAAS_WEBHOOK_AUTH_TOKEN antes de registrar o webhook.');

const baseUrl = getAsaasBaseUrl(env.ASAAS_ENV);
const events = [
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
  'ACCOUNT_STATUS_DOCUMENT_APPROVED',
  'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_DOCUMENT_PENDING',
  'ACCOUNT_STATUS_DOCUMENT_REJECTED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
  'CHECKOUT_CREATED',
  'CHECKOUT_PAID',
  'CHECKOUT_CANCELED',
  'CHECKOUT_EXPIRED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_DELETED',
  'PAYMENT_CREATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_SPLIT_DONE',
];

const listResponse = await fetch(`${baseUrl}/webhooks`, {
  headers: { accept: 'application/json', access_token: env.ASAAS_API_KEY! },
});
const listPayload = await listResponse.json().catch(() => null) as { data?: Array<{ id?: string; url?: string; enabled?: boolean }> } | null;
const existing = listPayload?.data?.find((webhook) => webhook.url === webhookUrl);
if (existing) {
  console.log('Webhook já existente no Asaas; nenhuma duplicata criada', {
    event: 'payments.asaas_webhook_already_exists',
    webhookId: existing.id,
    url: existing.url,
    enabled: existing.enabled,
  });
  process.exit(0);
}

const response = await fetch(`${baseUrl}/webhooks`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    access_token: env.ASAAS_API_KEY!,
  },
  body: JSON.stringify({
    name: 'MeuMonitorAI - Pagamentos e subcontas',
    url: webhookUrl,
    email: webhookEmail,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    sendType: 'SEQUENTIALLY',
    events,
  }),
});

const payload = await response.json().catch(() => null) as { id?: string; url?: string; enabled?: boolean; events?: string[]; errors?: unknown } | null;
if (!response.ok) {
  console.error('Falha ao registrar webhook no Asaas', {
    event: 'payments.asaas_webhook_registration_failed',
    status: response.status,
    response: payload,
  });
  process.exitCode = 1;
} else {
  console.log('Webhook registrado no Asaas', {
    event: 'payments.asaas_webhook_registered',
    webhookId: payload?.id,
    url: payload?.url ?? webhookUrl,
    enabled: payload?.enabled ?? true,
    eventCount: payload?.events?.length ?? events.length,
  });
}
