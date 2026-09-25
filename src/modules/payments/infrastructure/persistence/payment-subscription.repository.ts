import { prisma } from '../../../../lib/prisma.js';

export class PaymentSubscriptionRepository {
  async findStudentIdByUserId(userId: string) {
    const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
    return student?.id ?? null;
  }

  findIdempotency(studentId: string, operation: string, key: string) {
    return prisma.paymentIdempotencyKey.findUnique({ where: { studentId_operation_key: { studentId, operation, key } }, select: { state: true } });
  }

  async startIdempotency(studentId: string, operation: string, key: string, resourceId: string) {
    await prisma.paymentIdempotencyKey.create({ data: { studentId, operation, key, requestFingerprint: `${operation}:${resourceId}`, resourceId, state: 'IN_PROGRESS' } });
  }

  async completeIdempotency(studentId: string, operation: string, key: string, resourceId: string) {
    if (!key) return;
    await prisma.paymentIdempotencyKey.update({ where: { studentId_operation_key: { studentId, operation, key } }, data: { state: 'COMPLETED', resourceId } });
  }

  async failIdempotency(studentId: string, operation: string, key: string) {
    await prisma.paymentIdempotencyKey.update({ where: { studentId_operation_key: { studentId, operation, key } }, data: { state: 'FAILED' } });
  }

  findForStudent(subscriptionId: string, studentId: string) {
    return prisma.paymentSubscription.findFirst({
      where: { id: subscriptionId, studentId },
      include: { items: true },
    });
  }

  async detailForStudent(studentId: string, subscriptionId: string) {
    const subscriptions = await this.listForStudent(studentId);
    return subscriptions.find((subscription) => subscription.id === subscriptionId) ?? null;
  }

  updateItem(id: string, data: { status: string }) {
    return prisma.paymentSubscriptionItem.update({ where: { id }, data });
  }

  updateSubscription(id: string, data: { status?: string; cancelAtPeriodEnd?: boolean }) {
    return prisma.paymentSubscription.update({ where: { id }, data });
  }

  createAudit(data: { actorUserId: string; studentId: string; subscriptionId: string; monitorId: string; reason: string; endsAt?: string | null }) {
    return prisma.paymentAuditEntry.create({
      data: {
        actorUserId: data.actorUserId,
        studentId: data.studentId,
        monitorId: data.monitorId,
        origin: 'STUDENT_APP',
        reason: data.reason,
        after: { subscriptionId: data.subscriptionId, status: 'CANCEL_PENDING', endsAt: data.endsAt ?? null },
      },
    });
  }

  async listForStudent(studentId: string) {
    const subscriptions = await prisma.paymentSubscription.findMany({
      where: { studentId },
      include: {
        items: { include: { monitor: { select: { id: true, name: true } } } },
        charges: { orderBy: { createdAt: 'desc' }, take: 1, include: { splits: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return subscriptions.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      nextDueDate: subscription.nextDueDate?.toISOString() ?? null,
      providerSubscriptionId: subscription.providerSubscriptionId,
      items: subscription.items.map((item) => ({
        id: item.id,
        monitorId: item.monitorId,
        monitorName: item.monitor.name,
        status: item.status,
        priceCents: item.priceCentsSnapshot,
      })),
      latestCharge: subscription.charges[0] ? {
        status: subscription.charges[0].status,
        grossCents: subscription.charges[0].grossCents,
        servicePeriodStart: subscription.charges[0].servicePeriodStart?.toISOString() ?? null,
        servicePeriodEnd: subscription.charges[0].servicePeriodEnd?.toISOString() ?? null,
        splits: subscription.charges[0].splits.map((split) => ({ role: split.role, status: split.status, expectedCents: split.expectedCents, settledCents: split.settledCents })),
      } : null,
    }));
  }

  async historyForStudent(studentId: string) {
    const entries = await prisma.paymentAuditEntry.findMany({
      where: { studentId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
      select: { id: true, reason: true, monitorId: true, occurredAt: true, before: true, after: true, monitor: { select: { name: true } } },
    });
    return entries.map((entry) => {
      const after = entry.after && typeof entry.after === 'object' && !Array.isArray(entry.after)
        ? entry.after as Record<string, unknown>
        : {};
      return {
        id: entry.id,
        type: entry.reason.includes('CANCELLATION') ? 'REMOVE' : entry.reason,
        monitorId: entry.monitorId,
        monitorName: entry.monitor?.name ?? null,
        createdAt: entry.occurredAt.toISOString(),
        endsAt: typeof after.endsAt === 'string' ? after.endsAt : null,
        reason: entry.reason,
      };
    });
  }
}
