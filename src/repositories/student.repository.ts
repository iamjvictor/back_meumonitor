import { prisma } from '../lib/prisma.js';

export interface CreateStudentInput {
  userId: string;
  fullName: string;
  email: string;
  phone?: string;
  cpf?: string;
  avatarUrl?: string;
}

export class StudentRepository {
  async findByUserId(userId: string) {
    return prisma.student.findUnique({
      where: { userId },
      include: {
        subscriptions: {
          include: {
            monitor: true,
          },
        },
      },
    });
  }

  async findByEmail(email: string) {
    return prisma.student.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async upsertStudent(data: CreateStudentInput) {
    return prisma.student.upsert({
      where: { userId: data.userId },
      update: {
        fullName: data.fullName,
        phone: data.phone,
        cpf: data.cpf,
        avatarUrl: data.avatarUrl,
      },
      create: {
        userId: data.userId,
        fullName: data.fullName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        cpf: data.cpf,
        avatarUrl: data.avatarUrl,
        role: 'student',
        status: 'active',
      },
    });
  }

  async createSubscription(studentId: string, monitorId: string, amountPaid: number = 0) {
    return prisma.studentSubscription.upsert({
      where: {
        studentId_monitorId: {
          studentId,
          monitorId,
        },
      },
      update: {
        status: 'active',
        amountPaid,
      },
      create: {
        studentId,
        monitorId,
        status: 'active',
        amountPaid,
      },
    });
  }
}
