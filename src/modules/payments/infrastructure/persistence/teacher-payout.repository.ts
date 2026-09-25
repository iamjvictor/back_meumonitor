import { prisma } from '../../../../lib/prisma.js';

export class TeacherPayoutRepository {
  async listForTeacher(teacherId: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const items = await prisma.paymentSubscriptionItem.findMany({
      where: {
        teacherId,
        OR: [
          { status: { in: ['ACTIVE', 'CANCEL_PENDING'] } },
          { status: 'CANCELLED', updatedAt: { gte: startOfMonth } },
        ],
      },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        monitor: { select: { id: true, name: true } },
        subscription: {
          select: {
            status: true,
            currentPeriodEnd: true,
            cancelledAt: true,
            charges: { orderBy: { createdAt: 'desc' }, take: 1, include: { splits: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => {
      const charge = item.subscription.charges[0];
      const split = charge?.splits.find((candidate) => candidate.role === 'TEACHER' && candidate.walletId);
      return {
        id: item.id,
        subscriptionId: item.subscriptionId,
        studentId: item.student.id,
        studentName: item.student.fullName,
        email: item.student.email,
        monitorId: item.monitor.id,
        monitorName: item.monitor.name,
        subscriptionStatus: item.subscription.status,
        itemStatus: item.status,
        grossCents: charge?.grossCents ?? item.priceCentsSnapshot,
        teacherPercentageSnapshot: item.teacherPercentageSnapshot.toString(),
        expectedCents: split?.expectedCents ?? Math.round((charge?.grossCents ?? item.priceCentsSnapshot) * Number(item.teacherPercentageSnapshot) / 100),
        settledCents: split?.settledCents ?? 0,
        splitStatus: split?.status ?? 'PENDING',
        servicePeriodEnd: item.subscription.currentPeriodEnd?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        cancelledAt: item.subscription.cancelledAt?.toISOString() ?? (item.status === 'CANCEL_PENDING' || item.status === 'CANCELLED' ? item.updatedAt.toISOString() : null),
      };
    });
  }
}
