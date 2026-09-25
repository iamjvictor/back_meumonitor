import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../lib/prisma.js';
import type { HostedCheckoutResult } from '../../domain/ports/payment-provider.port.js';

export type CheckoutStudent = { id: string; role: string };
export type CheckoutMonitor = {
  id: string;
  name: string;
  priceCents: number;
  teacher: {
    id: string;
    teacherPercentage: Prisma.Decimal;
    currentPaymentAccount: { walletId: string | null; status: string; generalStatus: string | null } | null;
    referralReceived: { indicatorTeacherId: string; percentage: Prisma.Decimal; status: string } | null;
  };
};

export type CheckoutIntent = {
  order: { id: string; subscriptionId: string; status: string; amountCents: number };
  checkout: { checkoutUrl: string | null; expiresAt: Date | null } | null;
  payout: { walletId: string | null; percentage: string };
};

export interface CreateCheckoutRepository {
  findStudentByUserId(userId: string): Promise<CheckoutStudent | null>;
  findPublishedMonitor(monitorId: string): Promise<CheckoutMonitor | null>;
  hasActiveSubscription(studentId: string, monitorId: string): Promise<boolean>;
  findIdempotency(studentId: string, key: string): Promise<{ requestFingerprint: string; state: string; order: CheckoutIntent['order'] | null; checkout: CheckoutIntent['checkout'] | null } | null>;
  resetFailedIdempotency(studentId: string, key: string): Promise<void>;
  createIntent(input: { studentId: string; monitor: CheckoutMonitor; idempotencyKey: string; requestFingerprint: string }): Promise<CheckoutIntent>;
  saveCheckout(orderId: string, checkout: HostedCheckoutResult): Promise<CheckoutIntent>;
  markCheckoutCreationFailed(orderId: string, message: string): Promise<void>;
}

export class PaymentCheckoutRepository implements CreateCheckoutRepository {
  findStudentByUserId(userId: string) {
    return prisma.student.findUnique({ where: { userId }, select: { id: true, role: true } });
  }

  findPublishedMonitor(monitorId: string) {
    return prisma.monitor.findFirst({
      where: { id: monitorId, status: 'PUBLISHED' },
      select: {
        id: true,
        name: true,
        priceCents: true,
        teacher: {
          select: {
            id: true,
            teacherPercentage: true,
            currentPaymentAccount: { select: { walletId: true, status: true, generalStatus: true } },
            referralReceived: { select: { indicatorTeacherId: true, percentage: true, status: true } },
          },
        },
      },
    });
  }

  async hasActiveSubscription(studentId: string, monitorId: string) {
    const [payment, legacy, billing] = await Promise.all([
      prisma.paymentSubscriptionItem.findFirst({ where: { studentId, monitorId, status: 'ACTIVE', subscription: { status: { in: ['ACTIVE', 'TRIALING'] } } }, select: { id: true } }),
      prisma.studentSubscription.findFirst({ where: { studentId, monitorId, status: 'active' }, select: { id: true } }),
      prisma.billingSubscriptionItem.findFirst({ where: { monitorId, status: 'ACTIVE', subscription: { studentId, status: { in: ['ACTIVE', 'TRIALING'] } } }, select: { id: true } }),
    ]);
    return Boolean(payment || legacy || billing);
  }

  async findIdempotency(studentId: string, key: string) {
    const record = await prisma.paymentIdempotencyKey.findUnique({
      where: { studentId_operation_key: { studentId, operation: 'CREATE_CHECKOUT', key } },
      select: { requestFingerprint: true, resourceId: true, state: true },
    });
    if (!record) return null;
    const order = record.resourceId ? await this.findOrder(record.resourceId) : null;
    return { requestFingerprint: record.requestFingerprint, state: record.state, order: order?.order ?? null, checkout: order?.checkout ?? null };
  }

  async resetFailedIdempotency(studentId: string, key: string) {
    console.log('Removendo chave de idempotência FAILED', {
      event: 'payments.checkout_failed_retry_reset_started',
      tableName: 'payment_idempotency_keys',
      studentId,
      key,
    });
    await prisma.paymentIdempotencyKey.deleteMany({
      where: { studentId, operation: 'CREATE_CHECKOUT', key, state: 'FAILED' },
    });
    console.log('Chave de idempotência FAILED removida', {
      event: 'payments.checkout_failed_retry_reset_persisted',
      tableName: 'payment_idempotency_keys',
      studentId,
      key,
    });
  }

  async createIntent(input: { studentId: string; monitor: CheckoutMonitor; idempotencyKey: string; requestFingerprint: string }) {
    const account = input.monitor.teacher.currentPaymentAccount;
    const accountEligible = Boolean(account && (account.status.toUpperCase() === 'APPROVED' || account.generalStatus?.toUpperCase() === 'APPROVED'));
    const walletId = accountEligible ? account?.walletId ?? null : null;
    const percentage = accountEligible ? new Prisma.Decimal(input.monitor.teacher.teacherPercentage).toFixed(4) : '0.0000';
    const referral = input.monitor.teacher.referralReceived?.status === 'ACTIVE' ? input.monitor.teacher.referralReceived : null;
    const orderId = randomUUID();
    const referralPercentage = referral ? new Prisma.Decimal(referral.percentage).toFixed(4) : '0.0000';
    const environment = (process.env.ASAAS_ENV ?? 'SANDBOX').toUpperCase();
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.create({
        data: {
          id: orderId,
          studentId: input.studentId,
          environment,
          status: 'PENDING',
          grossCents: input.monitor.priceCents,
          currency: 'BRL',
          externalReference: orderId,
          requestFingerprint: input.requestFingerprint,
          items: {
            create: {
              monitorId: input.monitor.id,
              teacherId: input.monitor.teacher.id,
              descriptionSnapshot: input.monitor.name,
              priceCentsSnapshot: input.monitor.priceCents,
              teacherPercentageSnapshot: percentage,
              referrerTeacherIdSnapshot: referral?.indicatorTeacherId ?? null,
              referralPercentageSnapshot: referralPercentage,
              quantity: 1,
            },
          },
          subscription: {
            create: {
              studentId: input.studentId,
              environment,
              status: 'PENDING',
              items: {
                create: {
                  studentId: input.studentId,
                  monitorId: input.monitor.id,
                  teacherId: input.monitor.teacher.id,
                  priceCentsSnapshot: input.monitor.priceCents,
                  teacherPercentageSnapshot: percentage,
                  referrerTeacherIdSnapshot: referral?.indicatorTeacherId ?? null,
                  referralPercentageSnapshot: referralPercentage,
                  status: 'PENDING',
                },
              },
            },
          },
        },
        select: { id: true, status: true, grossCents: true, subscription: { select: { id: true } } },
      });
      await tx.paymentIdempotencyKey.create({ data: { studentId: input.studentId, operation: 'CREATE_CHECKOUT', key: input.idempotencyKey, requestFingerprint: input.requestFingerprint, resourceId: order.id, state: 'IN_PROGRESS' } });
      return order;
    });
    return { order: { id: created.id, subscriptionId: created.subscription!.id, status: created.status, amountCents: created.grossCents }, checkout: null, payout: { walletId, percentage } };
  }

  async saveCheckout(orderId: string, checkout: HostedCheckoutResult) {
    const saved = await prisma.$transaction(async (tx) => {
      const record = await tx.paymentCheckout.create({ data: { orderId, environment: (process.env.ASAAS_ENV ?? 'SANDBOX').toUpperCase(), providerCheckoutId: checkout.providerCheckoutId, checkoutUrl: checkout.checkoutUrl, externalReference: orderId, status: 'PENDING', expiresAt: checkout.expiresAt }, select: { checkoutUrl: true, expiresAt: true } });
      await tx.paymentIdempotencyKey.updateMany({ where: { resourceId: orderId, operation: 'CREATE_CHECKOUT' }, data: { state: 'COMPLETED' } });
      const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, status: true, grossCents: true, subscription: { select: { id: true } } } });
      return { order, checkout: record };
    });
    return { order: { id: saved.order.id, subscriptionId: saved.order.subscription!.id, status: saved.order.status, amountCents: saved.order.grossCents }, checkout: saved.checkout, payout: { walletId: null, percentage: '0.0000' } };
  }

  async markCheckoutCreationFailed(orderId: string, message: string) {
    await prisma.$transaction([
      prisma.paymentOrder.update({ where: { id: orderId }, data: { status: 'CHECKOUT_CREATION_FAILED' } }),
      prisma.paymentIdempotencyKey.updateMany({ where: { resourceId: orderId, operation: 'CREATE_CHECKOUT' }, data: { state: 'FAILED' } }),
      prisma.paymentAuditEntry.create({ data: { origin: 'ASAAS_CHECKOUT', reason: 'CHECKOUT_CREATION_FAILED', studentId: undefined, before: {}, after: { orderId, message: message.slice(0, 500) } } }),
    ]);
  }

  private async findOrder(orderId: string) {
    const order = await prisma.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true, grossCents: true, subscription: { select: { id: true } }, checkouts: { orderBy: { attempt: 'desc' }, take: 1, select: { environment: true, checkoutUrl: true, providerCheckoutId: true, expiresAt: true } } } });
    if (!order || !order.subscription) return null;
    const checkout = order.checkouts[0];
    return {
      order: { id: order.id, subscriptionId: order.subscription.id, status: order.status, amountCents: order.grossCents },
      checkout: checkout ? {
        checkoutUrl: checkout.checkoutUrl ?? (checkout.providerCheckoutId ? buildAsaasCheckoutUrl(checkout.environment, checkout.providerCheckoutId) : null),
        expiresAt: checkout.expiresAt,
      } : null,
    };
  }
}

function buildAsaasCheckoutUrl(environment: string, checkoutId: string) {
  const origin = environment.toUpperCase() === 'SANDBOX' ? 'https://sandbox.asaas.com' : 'https://asaas.com';
  return `${origin}/checkoutSession/show/${encodeURIComponent(checkoutId)}`;
}
