import { env } from '../../config/env.js';
import { AsaasWebhookIngress } from './application/commands/accept-webhook.use-case.js';
import { AsaasWebhookController } from './http/asaas-webhook.controller.js';
import { PrismaPaymentWebhookRepository } from './infrastructure/persistence/prisma-webhook.repository.js';
import { enqueuePaymentWebhook } from './jobs/payment-webhook.queue.js';

export function createPaymentsWebhookModule() {
  const inbox = new PrismaPaymentWebhookRepository(env.ASAAS_ENV.toUpperCase());
  const ingress = new AsaasWebhookIngress({ accessToken: env.ASAAS_WEBHOOK_AUTH_TOKEN ?? '', inbox, enqueue: enqueuePaymentWebhook });
  const controller = new AsaasWebhookController(ingress);
  return { inbox, ingress, controller };
}
