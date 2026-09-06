import { prisma } from '../../../lib/prisma.js';

export class CustomerRepository {
  findStudentByUserId(userId: string) { return prisma.student.findUnique({ where: { userId }, select: { id: true, email: true } }); }
  findByStudentId(studentId: string) { return prisma.stripeCustomer.findUnique({ where: { studentId } }); }
  findByProviderId(providerCustomerId: string) { return prisma.stripeCustomer.findUnique({ where: { providerCustomerId } }); }
  create(data: { studentId: string; provider?: string; providerCustomerId: string }) { return prisma.stripeCustomer.create({ data }); }
  async upsert(data: { studentId: string; provider?: string; providerCustomerId: string }) {
    const existing = await this.findByStudentId(data.studentId);
    if (existing && existing.providerCustomerId !== data.providerCustomerId) throw new Error('PROVIDER_CUSTOMER_ID_MISMATCH');
    if (existing) return existing;
    const byProvider = await this.findByProviderId(data.providerCustomerId);
    if (byProvider && byProvider.studentId !== data.studentId) throw new Error('CUSTOMER_STUDENT_MISMATCH');
    return this.create(data);
  }

  async assertBelongsToStudent(customerId: string, studentId: string) {
    const customer = await prisma.stripeCustomer.findUnique({ where: { id: customerId } });
    if (!customer || customer.studentId !== studentId) throw new Error('CUSTOMER_STUDENT_MISMATCH');
    return customer;
  }
}
