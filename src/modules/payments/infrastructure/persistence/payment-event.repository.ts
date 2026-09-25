import { prisma } from '../../../../lib/prisma.js';

export type PaymentEventRepositoryResult = {
  updatedRows: number;
  chargeId?: string;
  orderId?: string;
  subscriptionId?: string;
  studentId?: string;
  monitorId?: string;
  accessGranted: boolean;
};

type SubscriptionEventResult = { updatedRows: number };

export class PaymentEventRepository {
  async applySubscriptionEvent(input: { environment: string; eventId: string; eventType: string; payload: unknown; occurredAt: Date }): Promise<SubscriptionEventResult> {
    const payload = asRecord(input.payload);
    const subscriptionPayload = asRecord(payload.subscription);
    const paymentPayload = asRecord(payload.payment);
    const providerSubscriptionId = readString(subscriptionPayload.id) ?? readString(payload.subscriptionId) ?? readString(paymentPayload.subscription);
    if (!providerSubscriptionId) return { updatedRows: 0 };

    const subscription = await prisma.paymentSubscription.findFirst({
      where: { environment: input.environment, providerSubscriptionId },
      include: { items: true },
    });
    if (!subscription) return { updatedRows: 0 };

    const end = subscription.currentPeriodEnd;
    const isTerminal = input.eventType === 'SUBSCRIPTION_DELETED' || input.eventType === 'PAYMENT_REFUNDED' || input.eventType === 'PAYMENT_CHARGEBACK_REQUESTED';
    const nextStatus = isTerminal ? 'CANCELLED' : input.eventType === 'PAYMENT_OVERDUE' ? 'PAST_DUE' : subscription.status;
    await prisma.$transaction(async (transaction) => {
      await transaction.paymentSubscription.update({ where: { id: subscription.id }, data: { status: nextStatus, cancelAtPeriodEnd: isTerminal || subscription.cancelAtPeriodEnd, cancelledAt: isTerminal ? input.occurredAt : undefined } });
      if (isTerminal) {
        await transaction.paymentSubscriptionItem.updateMany({ where: { subscriptionId: subscription.id, status: { in: ['ACTIVE', 'CANCEL_PENDING'] } }, data: { status: 'CANCELLED' } });
        for (const item of subscription.items) {
          await transaction.studentSubscription.updateMany({ where: { paymentSubscriptionItemId: item.id }, data: { status: 'cancelled', cancelAtPeriodEnd: true, cancelledAt: input.occurredAt, expiresAt: end ?? undefined } });
          await transaction.studentEnrollment.updateMany({ where: { paymentSubscriptionItemId: item.id }, data: { status: 'CANCELLED', endsAt: end ?? undefined } });
        }
      }
      await transaction.paymentAuditEntry.create({ data: { origin: 'ASAAS_WEBHOOK', reason: input.eventType, studentId: subscription.studentId, after: { providerSubscriptionId, status: nextStatus, eventId: input.eventId } } });
    });
    return { updatedRows: 1 };
  }

  async applyPaymentEvent(input: { environment: string; eventId: string; eventType: string; payload: unknown; occurredAt: Date }): Promise<PaymentEventRepositoryResult> {
    const payload = asRecord(input.payload);
    const payment = asRecord(payload.payment);
    const providerPaymentId = readString(payment.id);
    if (!providerPaymentId) {
      console.warn('Webhook financeiro sem identificador de pagamento', { event: 'payments.payment_event_missing_provider_id', eventId: input.eventId, eventType: input.eventType });
      return { updatedRows: 0, accessGranted: false };
    }

    const externalReference = readString(payment.externalReference);
    const providerCheckoutId = readString(payment.checkoutSession) ?? readString(payment.checkoutId);
    console.log('Correlação de pagamento Asaas iniciada', { event: 'payments.payment_correlation_started', eventId: input.eventId, eventType: input.eventType, providerPaymentId, externalReference, providerCheckoutId });
    const order = await prisma.paymentOrder.findFirst({
      where: {
        environment: input.environment,
        OR: [
          ...(externalReference ? [{ externalReference }] : []),
          ...(providerCheckoutId ? [{ checkouts: { some: { providerCheckoutId } } }] : []),
        ],
      },
      select: {
        id: true,
        studentId: true,
        items: { take: 1, select: { id: true, monitorId: true, priceCentsSnapshot: true } },
        subscription: { select: { id: true, status: true, providerSubscriptionId: true, currentPeriodStart: true, currentPeriodEnd: true, items: { take: 1, select: { id: true, monitorId: true, teacherId: true, teacherPercentageSnapshot: true, priceCentsSnapshot: true } } } },
      },
    });
    if (!order?.subscription || !order.items[0] || !order.subscription.items[0]) {
      console.log('Pagamento Asaas aguardando correlação com pedido', { event: 'payments.payment_correlation_waiting', eventId: input.eventId, providerPaymentId, externalReference, providerCheckoutId });
      return { updatedRows: 0, accessGranted: false };
    }

    const orderItem = order.items[0];
    const subscription = order.subscription;
    const subscriptionItem = subscription.items[0]!;
    const valueCents = readMoneyInCents(payment.value) ?? orderItem.priceCentsSnapshot;
    const periodStart = subscription.currentPeriodStart ?? input.occurredAt;
    const periodEnd = subscription.currentPeriodEnd ?? addOneMonth(periodStart);
    const status = input.eventType === 'PAYMENT_RECEIVED' ? 'RECEIVED' : 'CONFIRMED';
    const dueDate = readDate(payment.dueDate);
    const providerSubscriptionId = readString(payment.subscription);
    const netCents = readMoneyInCents(payment.netValue);
    const feeCents = netCents === null ? null : valueCents - netCents;

    console.log('Persistência financeira e liberação de acesso iniciadas', { event: 'payments.payment_access_persistence_started', eventId: input.eventId, tableNames: ['payment_charges', 'payment_subscriptions', 'payment_subscription_items', 'student_subscriptions', 'student_enrollments'], providerPaymentId, orderId: order.id, subscriptionId: subscription.id, studentId: order.studentId, monitorId: orderItem.monitorId, status, valueCents });
    const result = await prisma.$transaction(async (transaction) => {
      const charge = await transaction.paymentCharge.upsert({
        where: { environment_providerPaymentId: { environment: input.environment, providerPaymentId } },
        create: { subscriptionId: subscription.id, environment: input.environment, providerPaymentId, providerCheckoutId, dueDate, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd, status, grossCents: valueCents, netCents, feeCents, confirmedAt: status === 'CONFIRMED' ? input.occurredAt : null, receivedAt: status === 'RECEIVED' ? input.occurredAt : null },
        update: { status, dueDate, netCents: netCents ?? undefined, feeCents: feeCents ?? undefined, confirmedAt: status === 'CONFIRMED' ? input.occurredAt : undefined, receivedAt: status === 'RECEIVED' ? input.occurredAt : undefined },
      });
      console.log('Cobrança Asaas persistida', { event: 'payments.payment_charge_persisted', tableName: 'payment_charges', eventId: input.eventId, chargeId: charge.id, providerPaymentId, status });

      const teacherPercentage = Number(subscriptionItem.teacherPercentageSnapshot);
      const existingTeacherSplit = await transaction.paymentSplit.findFirst({ where: { chargeId: charge.id, role: 'TEACHER' } });
      const splitData = { destination: teacherPercentage > 0 ? 'TEACHER' : 'PLATFORM', payoutMode: teacherPercentage > 0 ? 'TEACHER_ACCOUNT' as const : 'PLATFORM_FALLBACK' as const, contractedPercentage: teacherPercentage, effectivePercentage: teacherPercentage, expectedCents: Math.round(valueCents * teacherPercentage / 100), fallbackReason: teacherPercentage > 0 ? null : 'TEACHER_ACCOUNT_NOT_ELIGIBLE' };
      if (existingTeacherSplit) await transaction.paymentSplit.update({ where: { id: existingTeacherSplit.id }, data: splitData });
      else await transaction.paymentSplit.create({ data: { chargeId: charge.id, role: 'TEACHER', ...splitData, settledCents: null, status: 'PENDING' } });

      for (const [index, observed] of readEffectiveSplits(input.payload, valueCents, input.eventType).entries()) {
        const role = index === 0 ? 'TEACHER' : `SPLIT_${index + 1}`;
        const existing = await transaction.paymentSplit.findFirst({
          where: {
            chargeId: charge.id,
            OR: [
              ...(observed.providerSplitId ? [{ providerSplitId: observed.providerSplitId }] : []),
              ...(observed.walletId ? [{ walletId: observed.walletId, role }] : []),
            ],
          },
        });
        const observedData = {
          role,
          walletId: observed.walletId,
          providerSplitId: observed.providerSplitId,
          destination: 'TEACHER',
          payoutMode: 'TEACHER_ACCOUNT' as const,
          effectivePercentage: observed.effectivePercentage,
          expectedCents: observed.amountCents,
          settledCents: observed.settledCents,
          status: observed.status,
          fallbackReason: null,
        };
        if (existing) await transaction.paymentSplit.update({ where: { id: existing.id }, data: observedData });
        else await transaction.paymentSplit.create({ data: { chargeId: charge.id, contractedPercentage: index === 0 ? teacherPercentage : observed.effectivePercentage, ...observedData } });
      }

      await transaction.paymentSubscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', providerSubscriptionId: providerSubscriptionId ?? undefined, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextDueDate: periodEnd } });
      console.log('Assinatura financeira ativada', { event: 'payments.subscription_activated', tableName: 'payment_subscriptions', eventId: input.eventId, subscriptionId: subscription.id, providerSubscriptionId, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd });
      await transaction.paymentSubscriptionItem.update({ where: { id: subscriptionItem.id }, data: { status: 'ACTIVE' } });

      await transaction.studentSubscription.upsert({
        where: { studentId_monitorId: { studentId: order.studentId, monitorId: orderItem.monitorId } },
        create: { studentId: order.studentId, monitorId: orderItem.monitorId, status: 'active', amountPaid: valueCents / 100, startsAt: periodStart, expiresAt: periodEnd, gatewaySubscriptionId: providerSubscriptionId, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, paymentSubscriptionItemId: subscriptionItem.id, lastPaymentChargeId: charge.id },
        update: { status: 'active', amountPaid: valueCents / 100, startsAt: periodStart, expiresAt: periodEnd, gatewaySubscriptionId: providerSubscriptionId ?? undefined, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, paymentSubscriptionItemId: subscriptionItem.id, lastPaymentChargeId: charge.id, cancelledAt: null, cancelAtPeriodEnd: false },
      });
      console.log('Projeção de assinatura do aluno atualizada', { event: 'payments.student_subscription_access_upserted', tableName: 'student_subscriptions', eventId: input.eventId, studentId: order.studentId, monitorId: orderItem.monitorId, chargeId: charge.id, periodEnd });

      await transaction.studentEnrollment.upsert({
        where: { studentId_monitorId: { studentId: order.studentId, monitorId: orderItem.monitorId } },
        create: { studentId: order.studentId, monitorId: orderItem.monitorId, status: 'ACTIVE', startsAt: periodStart, endsAt: periodEnd, paymentSubscriptionItemId: subscriptionItem.id },
        update: { status: 'ACTIVE', startsAt: periodStart, endsAt: periodEnd, paymentSubscriptionItemId: subscriptionItem.id },
      });
      console.log('Enrollment do aluno atualizado', { event: 'payments.student_enrollment_upserted', tableName: 'student_enrollments', eventId: input.eventId, studentId: order.studentId, monitorId: orderItem.monitorId, paymentSubscriptionItemId: subscriptionItem.id });
      await transaction.paymentOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_CONFIRMED' } });
      return charge;
    });
    console.log('Acesso do aluno liberado por confirmação financeira', { event: 'payments.student_access_granted', eventId: input.eventId, chargeId: result.id, orderId: order.id, subscriptionId: subscription.id, studentId: order.studentId, monitorId: orderItem.monitorId, periodStart, periodEnd });
    return { updatedRows: 1, chargeId: result.id, orderId: order.id, subscriptionId: subscription.id, studentId: order.studentId, monitorId: orderItem.monitorId, accessGranted: true };
  }
}

export type EffectivePaymentSplit = {
  providerSplitId: string | null;
  walletId: string | null;
  effectivePercentage: number;
  amountCents: number;
  settledCents: number | null;
  status: string;
};

export function readEffectiveSplits(payload: unknown, grossCents: number, eventType: string): EffectivePaymentSplit[] {
  const root = asRecord(payload);
  const payment = asRecord(root.payment);
  const rawSplits = Array.isArray(payment.split)
    ? payment.split
    : Array.isArray(payment.splits)
      ? payment.splits
      : Array.isArray(root.split)
        ? root.split
        : Array.isArray(root.splits)
          ? root.splits
          : [];
  return rawSplits.flatMap((value) => {
    const split = asRecord(value);
    const amountCents = readMoneyInCents(split.totalValue) ?? readMoneyInCents(split.value) ?? readMoneyInCents(split.fixedValue);
    const percentage = readNumber(split.percentualValue) ?? (amountCents === null || grossCents <= 0 ? null : amountCents / grossCents * 100);
    const providerSplitId = readString(split.id) ?? null;
    const walletId = readString(split.walletId) ?? null;
    if (amountCents === null || percentage === null || (!providerSplitId && !walletId)) return [];
    const rawStatus = readString(split.status)?.toUpperCase();
    const settled = eventType === 'PAYMENT_SPLIT_DONE' || rawStatus === 'DONE' || rawStatus === 'SETTLED' || rawStatus === 'RECEIVED';
    return [{
      providerSplitId,
      walletId,
      effectivePercentage: percentage,
      amountCents,
      settledCents: settled ? amountCents : null,
      status: settled ? 'SETTLED' : 'PENDING',
    }];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readMoneyInCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value) * 100);
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addOneMonth(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
