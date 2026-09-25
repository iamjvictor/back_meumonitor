import { prisma } from '../../../lib/prisma.js';

export type ExperienceFilter = {
  studentId: string;
  monitorId?: string;
  startDate?: Date;
  endDate?: Date;
};

export class StudentExperienceRepository {
  async findStudentByUserId(userId: string) {
    return prisma.student.findUnique({
      where: { userId },
      select: { id: true, fullName: true, email: true },
    });
  }

  async getQuestionAttempts(filter: ExperienceFilter) {
    const whereClause: Record<string, unknown> = {
      studentId: filter.studentId,
    };

    if (filter.monitorId) {
      whereClause.monitorId = filter.monitorId;
    }

    if (filter.startDate || filter.endDate) {
      whereClause.answeredAt = {
        ...(filter.startDate ? { gte: filter.startDate } : {}),
        ...(filter.endDate ? { lt: filter.endDate } : {}),
      };
    }

    return prisma.studentQuestionAttempt.findMany({
      where: whereClause,
      select: {
        id: true,
        mode: true,
        isCorrect: true,
        answeredAt: true,
        monitorId: true,
      },
      orderBy: { answeredAt: 'asc' },
    });
  }

  async getFlashcardReviewLogs(filter: ExperienceFilter) {
    const whereClause: Record<string, unknown> = {
      studentId: filter.studentId,
    };

    if (filter.startDate || filter.endDate) {
      whereClause.reviewedAt = {
        ...(filter.startDate ? { gte: filter.startDate } : {}),
        ...(filter.endDate ? { lt: filter.endDate } : {}),
      };
    }

    if (filter.monitorId) {
      whereClause.flashcard = {
        monitorId: filter.monitorId,
      };
    }

    return prisma.studentFlashcardReviewLog.findMany({
      where: whereClause,
      select: {
        id: true,
        rating: true,
        reviewedAt: true,
      },
      orderBy: { reviewedAt: 'asc' },
    });
  }
}
