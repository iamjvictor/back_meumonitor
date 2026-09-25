import type { PrismaPaymentWebhookRepository } from '../infrastructure/persistence/prisma-webhook.repository.js';
import { enqueuePaymentWebhook } from './payment-webhook.queue.js';

export class PaymentWebhookRecoveryJob {
  constructor(private readonly repository: PrismaPaymentWebhookRepository) {}

  async run() {
    const events = await this.repository.findRecoverable(100);
    for (const event of events) {
      try {
        await enqueuePaymentWebhook(event.id, { recovery: true });
      } catch (error) {
        console.warn('Falha ao recuperar webhook persistido', {
          event: 'payments.webhook_recovery_failed',
          eventId: event.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return events.length;
  }
}
