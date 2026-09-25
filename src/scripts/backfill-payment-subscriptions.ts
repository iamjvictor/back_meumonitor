import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const environment = (process.env.ASAAS_ENV ?? 'sandbox').toUpperCase();

const legacyRows = await prisma.studentSubscription.findMany({
  where: { status: { in: ['active', 'ACTIVE'] } },
  include: { student: true, monitor: { include: { teacher: true } } },
});

let created = 0;
let skipped = 0;
for (const legacy of legacyRows) {
  const externalReference = `legacy-student-subscription:${legacy.id}`;
  const existing = await prisma.paymentOrder.findFirst({ where: { environment, externalReference }, select: { id: true } });
  if (existing) { skipped += 1; continue; }

  const existingProviderSubscription = legacy.gatewaySubscriptionId
    ? await prisma.paymentSubscription.findFirst({ where: { environment, providerSubscriptionId: legacy.gatewaySubscriptionId }, include: { items: true } })
    : null;
  if (existingProviderSubscription) {
    if (existingProviderSubscription.studentId !== legacy.studentId) {
      console.warn(JSON.stringify({ event: 'payments.backfill_provider_subscription_conflict', legacyId: legacy.id, providerSubscriptionId: legacy.gatewaySubscriptionId, expectedStudentId: legacy.studentId, actualStudentId: existingProviderSubscription.studentId }));
      continue;
    }
    const existingItem = existingProviderSubscription.items.find((item) => item.studentId === legacy.studentId && item.monitorId === legacy.monitorId);
    if (existingItem) {
      await prisma.$transaction([
        prisma.studentSubscription.update({ where: { id: legacy.id }, data: { paymentSubscriptionItemId: existingItem.id } }),
        prisma.studentEnrollment.updateMany({ where: { studentId: legacy.studentId, monitorId: legacy.monitorId }, data: { paymentSubscriptionItemId: existingItem.id } }),
      ]);
      skipped += 1;
      continue;
    }
  }

  const amountCents = Math.max(0, Math.round((legacy.amountPaid || legacy.monitor.priceCents / 100) * 100));
  const percentage = new Prisma.Decimal(legacy.monitor.teacher.teacherPercentage);
  const createdRecord = await prisma.$transaction(async (tx) => {
    const order = await tx.paymentOrder.create({
      data: {
        studentId: legacy.studentId,
        environment,
        status: 'PAYMENT_CONFIRMED',
        grossCents: amountCents,
        currency: 'BRL',
        externalReference,
        requestFingerprint: externalReference,
        items: { create: {
          monitorId: legacy.monitorId,
          teacherId: legacy.monitor.teacherId,
          descriptionSnapshot: legacy.monitor.name,
          priceCentsSnapshot: amountCents,
          teacherPercentageSnapshot: percentage,
          referralPercentageSnapshot: 0,
        } },
        subscription: { create: {
          studentId: legacy.studentId,
          environment,
          providerSubscriptionId: legacy.gatewaySubscriptionId,
          status: 'ACTIVE',
          currentPeriodStart: legacy.currentPeriodStart ?? legacy.startsAt,
          currentPeriodEnd: legacy.currentPeriodEnd ?? legacy.expiresAt,
          nextDueDate: legacy.currentPeriodEnd ?? legacy.expiresAt,
          items: { create: {
            studentId: legacy.studentId,
            monitorId: legacy.monitorId,
            teacherId: legacy.monitor.teacherId,
            priceCentsSnapshot: amountCents,
            teacherPercentageSnapshot: percentage,
            referralPercentageSnapshot: 0,
            status: 'ACTIVE',
          } },
        } },
      },
      include: { subscription: { include: { items: true } } },
    });
    const item = order.subscription?.items[0];
    if (item) {
      await tx.studentSubscription.update({ where: { id: legacy.id }, data: { paymentSubscriptionItemId: item.id } });
      await tx.studentEnrollment.updateMany({ where: { studentId: legacy.studentId, monitorId: legacy.monitorId }, data: { paymentSubscriptionItemId: item.id } });
    }
    return order;
  });
  created += createdRecord.subscription ? 1 : 0;
}

console.log(JSON.stringify({ environment, scanned: legacyRows.length, created, skipped }));
await prisma.$disconnect();
