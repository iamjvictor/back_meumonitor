import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { BillingWebhook } from '../services/webhook.service.js';

export class WebhookEventRepository {
  find(provider: string, providerEventId: string) { return prisma.billingWebhookEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId } } }); }
  create(data: Prisma.BillingWebhookEventUncheckedCreateInput) { return prisma.billingWebhookEvent.create({ data }); }
  async claimEvent(provider: string, event: BillingWebhook) {
    try {
      const created = await this.create({ provider, providerEventId: event.providerEventId, eventType: event.type, payload: event.payload ?? {} , status: 'CLAIMED' });
      return { created: true, event: created };
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code !== 'P2002') throw error;
      const existing = await this.find(provider, event.providerEventId);
      if (!existing) throw error;
      if (existing.status === 'FAILED') {
        const reopened = await prisma.billingWebhookEvent.updateMany({ where: { id: existing.id, status: 'FAILED' }, data: { status: 'CLAIMED', failureMessage: null } });
        if (reopened.count === 1) return { created: false, event: { ...existing, status: 'CLAIMED' } };
      }
      return { created: false, event: existing };
    }
  }
  markProcessed(id: string) { return prisma.billingWebhookEvent.update({ where: { id }, data: { status: 'PROCESSED', processedAt: new Date(), failureMessage: null } }); }
  markFailed(id: string, failureMessage: string) { return prisma.billingWebhookEvent.update({ where: { id }, data: { status: 'FAILED', failureMessage } }); }
}
