import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

export class EnrollmentRepository {
  findByStudentMonitor(studentId: string, monitorId: string) { return prisma.studentEnrollment.findUnique({ where: { studentId_monitorId: { studentId, monitorId } } }); }
  listByStudent(studentId: string) { return prisma.studentEnrollment.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } }); }
  create(data: Prisma.StudentEnrollmentUncheckedCreateInput) { if (!data.subscriptionItemId) throw new Error('SUBSCRIPTION_ITEM_REQUIRED'); return prisma.studentEnrollment.create({ data }); }
  upsert(data: Prisma.StudentEnrollmentUncheckedCreateInput) { if (!data.subscriptionItemId) throw new Error('SUBSCRIPTION_ITEM_REQUIRED'); return prisma.studentEnrollment.upsert({ where: { studentId_monitorId: { studentId: data.studentId, monitorId: data.monitorId } }, create: data, update: data }); }
}
