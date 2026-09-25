import { prisma } from '../../../lib/prisma.js';
import type { EntitlementRepository, EntitlementRepositoryRow } from '../application/entitlement.service.js';

export class PaymentEntitlementRepository implements EntitlementRepository {
  async findStudentIdByUserId(userId: string) {
    const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
    return student?.id ?? null;
  }

  async listForStudent(studentId: string): Promise<EntitlementRepositoryRow[]> {
    const subscriptions = await prisma.paymentSubscription.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { include: { monitor: { include: { teacher: { select: { id: true, fullName: true, avatarUrl: true, bannerUrl: true } }, subjects: { include: { topics: { select: { id: true, name: true }, orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } } } } } },
      },
    });
    const monitorIds = [...new Set(subscriptions.flatMap((subscription) => subscription.items.map((item) => item.monitorId)))];
    const counts = await prisma.monitor.findMany({
      where: { id: { in: monitorIds } },
      select: {
        id: true,
        _count: {
          select: {
            questions: { where: { status: 'APPROVED' } },
            flashcards: { where: { status: 'APPROVED' } },
          },
        },
      },
    });
    const countsByMonitor = new Map(counts.map((count) => [count.id, count._count]));
    return subscriptions.flatMap((subscription) => subscription.items.map((item) => ({
      monitorId: item.monitor.id, monitorName: item.monitor.name, monitorAvatarUrl: item.monitor.avatarUrl, teacherId: item.monitor.teacher.id, teacherName: item.monitor.teacher.fullName, teacherAvatarUrl: item.monitor.teacher.avatarUrl, teacherBannerUrl: item.monitor.teacher.bannerUrl,
      subscriptionId: subscription.id, providerSubscriptionId: subscription.providerSubscriptionId,
      subscriptionStatus: subscription.status, itemStatus: item.status, purchasedAt: subscription.createdAt.toISOString(),
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelRequestedAt: subscription.cancelledAt?.toISOString() ?? null,
      subjects: item.monitor.subjects.map((subject) => ({ id: subject.id, name: subject.name, topics: subject.topics.map((topic) => ({ id: topic.id, name: topic.name })) })),
      approvedQuestionCount: countsByMonitor.get(item.monitorId)?.questions ?? 0,
      approvedFlashcardCount: countsByMonitor.get(item.monitorId)?.flashcards ?? 0,
    })));
  }
}
