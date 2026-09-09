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
    return prisma.studentContentReport.create({
      data: {
        studentId: data.studentId,
        targetType: data.targetType,
        questionId: data.questionId,
        flashcardId: data.flashcardId,
        reason: data.reason,
        description: data.description,
      },
    });
  }
}
