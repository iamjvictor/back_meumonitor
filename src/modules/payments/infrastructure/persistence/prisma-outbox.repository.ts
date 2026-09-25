import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';

export class PrismaPaymentOutboxRepository {
  createInTransaction(
    transaction: Prisma.TransactionClient,
    input: { eventId: string; aggregateId: string; eventType: string; payload: Prisma.InputJsonValue },
  ) {
    return transaction.paymentOutboxEvent.create({
      data: {
        eventId: input.eventId,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        state: 'PENDING',
      },
    });
  }

  findPending(limit = 100) {
    return prisma.paymentOutboxEvent.findMany({
      where: { state: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  markProcessed(id: string) {
    return prisma.paymentOutboxEvent.update({ where: { id }, data: { state: 'PROCESSED', processedAt: new Date() } });
  }

  markFailed(id: string, message: string) {
    console.warn('Falha no evento de outbox de pagamentos', { event: 'payments.outbox_failed', outboxId: id, message });
    return prisma.paymentOutboxEvent.update({ where: { id }, data: { state: 'FAILED', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) } });
  }
}
