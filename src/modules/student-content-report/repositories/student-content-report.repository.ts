import { prisma } from '../../../lib/prisma.js';
import type { StudentContentReport, ContentReportTargetType } from '@prisma/client';

export class StudentContentReportRepository {
  async create(data: {
    studentId: string;
    targetType: ContentReportTargetType;
    questionId?: string;
    flashcardId?: string;
    reason: string;
    description?: string;
  }): Promise<StudentContentReport> {
    return prisma.$transaction(async (tx) => {
      const report = await tx.studentContentReport.create({
        data: {
          studentId: data.studentId,
          targetType: data.targetType,
          questionId: data.questionId,
          flashcardId: data.flashcardId,
          reason: data.reason,
          description: data.description,
        },
      });

      if (data.targetType === 'QUESTION') {
        if (!data.questionId) throw new Error('Question ID is required when reporting a question');
        await tx.question.update({
          where: { id: data.questionId },
          data: { status: 'REPORTED' },
        });
      } else {
        if (!data.flashcardId) throw new Error('Flashcard ID is required when reporting a flashcard');
        await tx.flashcard.update({
          where: { id: data.flashcardId },
          data: { status: 'REPORTED' },
        });
      }

      return report;
    });
  }
}
