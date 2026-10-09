import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';

type AccountStatusWebhookPayload = {
  id: string;
  event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED';
  dateCreated: string;
  account: {
    object: 'account';
    id: string;
    status: 'APPROVED';
  };
};

export function buildAccountStatusWebhookPayload(providerAccountId: string): AccountStatusWebhookPayload {
  return {
    id: `evt_test_account_approved_${randomUUID()}`,
    event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    dateCreated: new Date().toISOString(),
    account: {
      object: 'account',
      id: providerAccountId,
      status: 'APPROVED',
    },
  };
}

async function main() {
  const providerAccountId = process.argv[2]?.trim();
  if (!providerAccountId) throw new Error('Uso: npm run asaas:webhook:test-account-approved -- <providerAccountId>');

  const webhookUrl = env.ASAAS_WEBHOOK_URL
    ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined);
  if (!webhookUrl) throw new Error('Defina ASAAS_WEBHOOK_URL ou PUBLIC_API_URL antes de testar o webhook.');
  if (!env.ASAAS_WEBHOOK_AUTH_TOKEN) throw new Error('Defina ASAAS_WEBHOOK_AUTH_TOKEN antes de testar o webhook.');

  const payload = buildAccountStatusWebhookPayload(providerAccountId);
  console.log('Enviando evento sintético de aprovação de subconta', {
    event: 'payments.asaas_account_status_webhook_test_started',
    webhookUrl,
    providerAccountId,
    providerEventId: payload.id,
    eventType: payload.event,
  });

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'asaas-access-token': env.ASAAS_WEBHOOK_AUTH_TOKEN,
      'x-asaas-account-id': providerAccountId,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json().catch(() => null);
  console.log('Resposta do endpoint de webhook', {
    event: 'payments.asaas_account_status_webhook_test_completed',
    status: response.status,
    ok: response.ok,
    responseBody,
  });

  if (!response.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
