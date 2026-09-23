import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import type { PaymentWebhookInbox, PaymentWebhookInboxInput } from '../../application/commands/accept-webhook.use-case.js';
import { PrismaPaymentOutboxRepository } from './prisma-outbox.repository.js';

export class PrismaPaymentWebhookRepository implements PaymentWebhookInbox {
  constructor(
    private readonly environment: string,
    private readonly outbox = new PrismaPaymentOutboxRepository(),
  ) {}

  async accept(input: PaymentWebhookInboxInput) {
    console.log('Persistindo evento de webhook Asaas', { event: 'payments.webhook_inbox_write_started', tableName: 'payment_webhook_events', providerEventId: input.providerEventId, eventType: input.eventType, providerAccountId: input.providerAccountId });
    try {
      const event = await prisma.$transaction(async (transaction) => {
        const created = await transaction.paymentWebhookEvent.create({
          data: {
            environment: this.environment,
            providerAccountId: input.providerAccountId,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            payload: input.payload as Prisma.InputJsonValue,
            state: 'RECEIVED',
          },
        });
        await this.outbox.createInTransaction(transaction, {
          eventId: `payment-webhook:${this.environment}:${input.providerEventId}`,
          aggregateId: created.id,
          eventType: 'PAYMENT_WEBHOOK_RECEIVED',
          payload: { eventId: created.id, eventType: input.eventType },
        });
        return created;
      });
      console.log('Evento de webhook Asaas persistido', { event: 'payments.webhook_inbox_write_completed', tableName: 'payment_webhook_events', eventId: event.id, providerEventId: input.providerEventId, state: event.state });
      return { id: event.id, duplicate: false, state: event.state };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await prisma.paymentWebhookEvent.findFirst({
        where: {
          environment: this.environment,
          providerAccountId: input.providerAccountId,
          providerEventId: input.providerEventId,
        },
        select: { id: true, state: true },
      });
      if (!existing) throw error;
      console.log('Webhook Asaas duplicado identificado', { event: 'payments.webhook_duplicate', tableName: 'payment_webhook_events', eventId: existing.id, providerEventId: input.providerEventId, state: existing.state });
      return { id: existing.id, duplicate: true, state: existing.state };
    }
  }

  async claim(eventId: string) {
    console.log('Tentando reivindicar webhook Asaas para processamento', { event: 'payments.webhook_claim_started', tableName: 'payment_webhook_events', eventId });
    const leaseUntil = new Date(Date.now() + 5 * 60_000);
    const claimed = await prisma.paymentWebhookEvent.updateMany({
      where: {
        id: eventId,
        OR: [
          { state: 'RECEIVED' },
          { state: 'FAILED', nextAttemptAt: { lte: new Date() } },
          { state: 'PROCESSING', leaseUntil: { lt: new Date() } },
        ],
      },
      data: { state: 'PROCESSING', attempts: { increment: 1 }, leaseUntil },
    });
    if (claimed.count !== 1) {
      console.log('Webhook Asaas não foi reivindicado', { event: 'payments.webhook_claim_skipped', tableName: 'payment_webhook_events', eventId });
      return null;
    }
    const event = await prisma.paymentWebhookEvent.findUnique({ where: { id: eventId } });
    console.log('Webhook Asaas reivindicado', { event: 'payments.webhook_claim_completed', tableName: 'payment_webhook_events', eventId, eventType: event?.eventType, attempts: event?.attempts });
    return event;
  }

  findRecoverable(limit = 100) {
    return prisma.paymentWebhookEvent.findMany({
      where: {
        state: { in: ['RECEIVED', 'FAILED', 'WAITING_CORRELATION'] },
        attempts: { lt: 10 },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
  }

  markWaitingCorrelation(eventId: string) {
    return prisma.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        state: 'WAITING_CORRELATION',
        leaseUntil: null,
        processedAt: null,
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
  }

  markProcessed(eventId: string, state = 'PROCESSED') {
    return prisma.paymentWebhookEvent.update({
      where: { id: eventId },
      data: { state, leaseUntil: null, processedAt: new Date(), nextAttemptAt: null },
    });
  }

  markIgnored(eventId: string) {
    return prisma.paymentWebhookEvent.update({ where: { id: eventId }, data: { state: 'IGNORED', leaseUntil: null, processedAt: new Date() } });
  }

  markFailed(eventId: string, message: string) {
    return prisma.paymentWebhookEvent.update({ where: { id: eventId }, data: { state: 'FAILED', leaseUntil: null, failureMessage: message, nextAttemptAt: new Date(Date.now() + 60_000) } });
  }
}
