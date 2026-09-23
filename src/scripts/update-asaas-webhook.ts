import { env } from '../config/env.js';
import { getAsaasBaseUrl } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';

const webhookId = env.ASAAS_WEBHOOK_ID;
const webhookUrl = env.ASAAS_WEBHOOK_URL ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined);
const webhookEmail = process.env.ASAAS_WEBHOOK_EMAIL;

if (!webhookId) throw new Error('Defina ASAAS_WEBHOOK_ID antes de atualizar o webhook.');
if (!webhookUrl) throw new Error('Defina ASAAS_WEBHOOK_URL ou PUBLIC_API_URL antes de atualizar o webhook.');
if (!webhookEmail) throw new Error('Defina ASAAS_WEBHOOK_EMAIL com o e-mail de alertas da conta principal do Asaas.');
if (!env.ASAAS_WEBHOOK_AUTH_TOKEN) throw new Error('Defina ASAAS_WEBHOOK_AUTH_TOKEN antes de atualizar o webhook.');

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
];

const response = await fetch(`${getAsaasBaseUrl(env.ASAAS_ENV)}/webhooks/${webhookId}`, {
  method: 'PUT',
  headers: { accept: 'application/json', 'content-type': 'application/json', access_token: env.ASAAS_API_KEY! },
  body: JSON.stringify({
    name: 'MeuMonitorAI - Status de subcontas',
    url: webhookUrl,
    email: webhookEmail,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: env.ASAAS_WEBHOOK_AUTH_TOKEN,
    sendType: 'SEQUENTIALLY',
    events,
  }),
});

const payload = await response.json().catch(() => null) as { id?: string; url?: string; enabled?: boolean; errors?: unknown } | null;
if (!response.ok) {
  console.error('Falha ao atualizar webhook no Asaas', { event: 'payments.asaas_webhook_update_failed', status: response.status, response: payload });
  process.exitCode = 1;
} else {
  console.log('Webhook atualizado no Asaas', { event: 'payments.asaas_webhook_updated', webhookId: payload?.id ?? webhookId, url: payload?.url ?? webhookUrl, enabled: payload?.enabled ?? true });
}
