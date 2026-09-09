import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

export class SubscriptionRepository {
  findSubscriptionForStudent(subscriptionId: string, studentId: string) { return prisma.billingSubscription.findFirst({ where: { id: subscriptionId, studentId }, include: { items: true } }); }
  findPublishedMonitor(monitorId: string) { return prisma.monitor.findFirst({ where: { id: monitorId, status: 'PUBLISHED' }, select: { id: true, name: true } }); }
  updateSubscriptionTotals(id: string, data: Prisma.BillingSubscriptionUpdateInput) { return prisma.billingSubscription.update({ where: { id }, data, include: { items: true } }); }
  createItem(data: Prisma.BillingSubscriptionItemUncheckedCreateInput) { return prisma.billingSubscriptionItem.create({ data }); }
  updateItem(id: string, data: Prisma.BillingSubscriptionItemUpdateInput) { return prisma.billingSubscriptionItem.update({ where: { id }, data }); }
  markItemPendingRemoval(id: string, data: Prisma.BillingSubscriptionItemUpdateInput) { return this.updateItem(id, data); }
  markEnrollmentPendingRemoval(studentId: string, monitorId: string, data: Prisma.StudentEnrollmentUpdateInput) { return prisma.studentEnrollment.update({ where: { studentId_monitorId: { studentId, monitorId } }, data }); }
  upsertEnrollment(data: Prisma.StudentEnrollmentUncheckedCreateInput) { return prisma.studentEnrollment.upsert({ where: { studentId_monitorId: { studentId: data.studentId, monitorId: data.monitorId } }, create: data, update: data }); }
  findByStudentId(studentId: string) { return prisma.billingSubscription.findFirst({ where: { studentId, status: { in: ['ACTIVE', 'TRIALING'] } }, include: { items: true }, orderBy: { createdAt: 'desc' } }); }
  async findSubscriptionsForUser(userId: string) { const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } }); if (!student) throw new Error('STUDENT_NOT_FOUND'); return prisma.billingSubscription.findMany({ where: { studentId: student.id }, include: { items: { include: { monitor: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' } }); }
  findHistoryByStudentId(studentId: string) { return prisma.billingSubscription.findMany({ where: { studentId }, include: { items: true }, orderBy: { createdAt: 'desc' } }); }
  async createActive(data: Prisma.BillingSubscriptionUncheckedCreateInput) {
    const active = await this.findByStudentId(data.studentId);
    if (active) throw new Error('ACTIVE_SUBSCRIPTION_EXISTS');
    await prisma.stripeCustomer.findUnique({ where: { id: data.customerId } }).then((customer) => {
      if (!customer || customer.studentId !== data.studentId) throw new Error('CUSTOMER_STUDENT_MISMATCH');
    });
    return this.create(data);
  }
  findByProviderId(providerSubscriptionId: string) { return prisma.billingSubscription.findUnique({ where: { providerSubscriptionId }, include: { items: true } }); }
  create(data: Prisma.BillingSubscriptionUncheckedCreateInput) { return prisma.billingSubscription.create({ data, include: { items: true } }); }
  upsertItem(data: Prisma.BillingSubscriptionItemUncheckedCreateInput) { return prisma.billingSubscriptionItem.upsert({ where: { subscriptionId_monitorId: { subscriptionId: data.subscriptionId, monitorId: data.monitorId } }, create: data, update: data }); }
  findItem(subscriptionId: string, monitorId: string) { return prisma.billingSubscriptionItem.findUnique({ where: { subscriptionId_monitorId: { subscriptionId, monitorId } } }); }
  findChangeByOperationKey(operationKey: string) {
    return prisma.billingSubscriptionChange.findUnique({ where: { operationKey } });
  }
  createChange(data: Prisma.BillingSubscriptionChangeUncheckedCreateInput) { return prisma.billingSubscriptionChange.create({ data }); }
}
