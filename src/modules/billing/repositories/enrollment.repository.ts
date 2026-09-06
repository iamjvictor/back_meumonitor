import { prisma } from '../../../lib/prisma.js';

export class EnrollmentRepository {
  findByStudentMonitor(studentId: string, monitorId: string) { return prisma.studentEnrollment.findUnique({ where: { studentId_monitorId: { studentId, monitorId } } }); }
  listByStudent(studentId: string) { return prisma.studentEnrollment.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } }); }
  create(data: any) { if (!data.subscriptionItemId) throw new Error('SUBSCRIPTION_ITEM_REQUIRED'); return prisma.studentEnrollment.create({ data }); }
  upsert(data: any) { if (!data.subscriptionItemId) throw new Error('SUBSCRIPTION_ITEM_REQUIRED'); return prisma.studentEnrollment.upsert({ where: { studentId_monitorId: { studentId: data.studentId, monitorId: data.monitorId } }, create: data, update: data }); }
}
