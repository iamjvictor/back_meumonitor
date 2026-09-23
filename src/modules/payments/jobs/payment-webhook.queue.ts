import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../../config/env.js';

export const PAYMENT_WEBHOOK_QUEUE_NAME = 'payments-webhooks';
export type PaymentWebhookJob = { eventId: string };

export const paymentWebhookQueueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const paymentWebhookQueue = new Queue<PaymentWebhookJob>(PAYMENT_WEBHOOK_QUEUE_NAME, {
  connection: paymentWebhookQueueConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 5000, age: 604800 },
  },
});

export async function enqueuePaymentWebhook(eventId: string) {
  console.log('Adicionando webhook Asaas à fila Redis', { event: 'payments.webhook_queue_add_started', queue: PAYMENT_WEBHOOK_QUEUE_NAME, eventId });
  await paymentWebhookQueue.add('process-payment-webhook', { eventId }, { jobId: eventId });
  console.log('Webhook Asaas adicionado à fila Redis', { event: 'payments.webhook_queue_add_completed', queue: PAYMENT_WEBHOOK_QUEUE_NAME, eventId });
}

export async function closePaymentWebhookQueue() {
  await paymentWebhookQueue.close();
  await paymentWebhookQueueConnection.quit();
}
