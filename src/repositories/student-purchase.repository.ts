import { prisma } from '../lib/prisma.js';

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(event, { event, ...data });
}

export class StudentPurchaseRepository {
  async findStudentByUserId(userId: string) { const result = await prisma.student.findUnique({ where: { userId }, select: { id: true } }); log('monitor.student_purchase_db_student_lookup_completed', { userId, found: Boolean(result), studentId: result?.id }); return result; }
  async findPublishedMonitors(ids: string[]) { const result = await prisma.monitor.findMany({ where: { id: { in: ids }, status: 'PUBLISHED' }, select: { id: true, name: true } }); log('monitor.student_purchase_db_monitors_lookup_completed', { requestedCount: ids.length, foundCount: result.length }); return result; }
  async findActiveSubscriptions(studentId: string, ids: string[]) { const result = await prisma.studentSubscription.findMany({ where: { studentId, monitorId: { in: ids }, status: 'active' }, select: { monitorId: true } }); log('monitor.student_purchase_db_active_subscriptions_lookup_completed', { studentId, monitorCount: ids.length, activeCount: result.length }); return result; }
  async findPurchaseByIdempotencyKey(key: string) { const result = await prisma.studentPurchase.findUnique({ where: { idempotencyKey: key }, include: { items: true } }); log('monitor.student_purchase_db_idempotency_lookup_completed', { found: Boolean(result), purchaseId: result?.id }); return result; }
  async createPurchase(data: any) { log('monitor.student_purchase_db_create_started', { studentId: data.studentId, itemCount: data.items?.create?.length, totalAmount: data.totalAmount }); const result = await prisma.studentPurchase.create({ data, include: { items: true } }); log('monitor.student_purchase_db_create_completed', { purchaseId: result.id, status: result.status }); return result; }
  findPurchaseForStudent(id: string, studentId: string) { return prisma.studentPurchase.findFirst({ where: { id, studentId }, include: { items: true } }); }
  async createPaymentSession(data: any) { log('monitor.student_purchase_db_payment_session_create_started', { purchaseId: data.purchaseId, studentId: data.studentId, expiresAt: data.expiresAt }); const result = await prisma.studentPaymentSession.create({ data }); log('monitor.student_purchase_db_payment_session_create_completed', { sessionRecordId: result.id, purchaseId: result.purchaseId }); return result; }
  async updatePurchaseCheckoutReference(purchaseId: string, reference: string) { const result = await prisma.studentPurchase.update({ where: { id: purchaseId }, data: { gateway: 'SIMULATED', gatewayCheckoutId: reference } }); log('monitor.student_purchase_db_checkout_reference_saved', { purchaseId, reference }); return result; }
  async findPaymentSessionByTokenHash(tokenHash: string) { const result = await prisma.studentPaymentSession.findUnique({ where: { tokenHash } }); log('monitor.student_purchase_db_payment_session_lookup_completed', { found: Boolean(result), sessionRecordId: result?.id, purchaseId: result?.purchaseId }); return result; }
  async consumePaymentSession(id: string) { log('monitor.student_purchase_db_payment_session_consume_started', { sessionRecordId: id }); const result = await prisma.studentPaymentSession.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } }); const session = await prisma.studentPaymentSession.findUnique({ where: { id } }); log('monitor.student_purchase_db_payment_session_consume_completed', { sessionRecordId: id, consumed: result.count === 1 }); return { consumed: result.count === 1, session }; }
  async listActiveSubscriptions(studentId: string) {
    const subRecords = await prisma.studentSubscription.findMany({
      where: { studentId, status: 'active' },
      select: { monitorId: true }
    });

    const enrollRecords = await prisma.studentEnrollment.findMany({
      where: { studentId, status: 'ACTIVE' },
      select: { monitorId: true }
    });

    const monitorIds = Array.from(new Set([
      ...subRecords.map(s => s.monitorId),
      ...enrollRecords.map(e => e.monitorId)
    ]));

    if (monitorIds.length === 0) return [];

    return prisma.monitor.findMany({
      where: { id: { in: monitorIds } },
      include: {
        teacher: true,
        subjects: {
          orderBy: { position: 'asc' },
          include: { topics: { orderBy: { position: 'asc' } } }
        },
        _count: {
          select: {
            questions: { where: { status: 'APPROVED' } },
            flashcards: { where: { status: 'APPROVED' } }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }
  async confirmPurchase(purchaseId: string, studentId: string) {
    log('monitor.student_purchase_db_confirmation_transaction_started', { purchaseId, studentId });
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.studentPurchase.findFirstOrThrow({ where: { id: purchaseId, studentId }, include: { items: true } });
      if (purchase.status === 'PAID') return purchase;
      if (purchase.status !== 'PENDING' && purchase.status !== 'PROCESSING') throw new Error('PURCHASE_NOT_CONFIRMABLE');
      for (const item of purchase.items) {
        const current = await tx.studentSubscription.findUnique({ where: { studentId_monitorId: { studentId, monitorId: item.monitorId } } });
        if (current?.status === 'active') throw new Error('ACTIVE_SUBSCRIPTION');
      }
      log('monitor.student_purchase_db_status_transition_started', { purchaseId: purchase.id, studentId, previousStatus: purchase.status, nextStatus: 'PAID' });
      await tx.studentPurchase.update({ where: { id: purchase.id }, data: { status: 'PAID', paidAt: new Date() } });
      log('monitor.student_purchase_db_status_transition_completed', { purchaseId: purchase.id, studentId, status: 'PAID' });
      for (const item of purchase.items) { await tx.studentSubscription.upsert({ where: { studentId_monitorId: { studentId, monitorId: item.monitorId } }, update: { status: 'active', purchaseId: purchase.id, lastPaymentId: purchase.id, startsAt: new Date(), amountPaid: item.unitAmount / 100 }, create: { studentId, monitorId: item.monitorId, status: 'active', purchaseId: purchase.id, lastPaymentId: purchase.id, startsAt: new Date(), amountPaid: item.unitAmount / 100 } }); log('monitor.student_purchase_db_subscription_upserted', { purchaseId: purchase.id, studentId, monitorId: item.monitorId }); }
      const result = await tx.studentPurchase.findUnique({ where: { id: purchase.id }, include: { items: true } });
      log('monitor.student_purchase_db_confirmation_transaction_completed', { purchaseId, studentId, status: result?.status });
      return result;
    });
  }
  async listPurchases(studentId: string) {
    const result = await prisma.studentPurchase.findMany({
      where: { studentId },
      include: {
        items: {
          include: {
            monitor: {
              include: {
                teacher: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    log('monitor.student_purchase_db_list_purchases_completed', { studentId, count: result.length });
    return result;
  }
}

