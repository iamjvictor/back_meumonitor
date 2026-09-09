import { StudentContentReportRepository } from '../repositories/student-content-report.repository.js';
import type { ContentReportTargetType } from '@prisma/client';

export class StudentContentReportService {
  private repository: StudentContentReportRepository;

  constructor() {
    this.repository = new StudentContentReportRepository();
  }

  async createReport(params: {
    studentId: string;
    targetType: ContentReportTargetType;
    questionId?: string;
    flashcardId?: string;
    reason: string;
    description?: string;
  }) {
    if (params.targetType === 'QUESTION' && !params.questionId) {
      throw new Error('Question ID is required when reporting a question');
    }
    if (params.targetType === 'FLASHCARD' && !params.flashcardId) {
      throw new Error('Flashcard ID is required when reporting a flashcard');
    }

    const report = await this.repository.create({
      studentId: params.studentId,
      targetType: params.targetType,
      questionId: params.questionId,
      flashcardId: params.flashcardId,
      reason: params.reason,
      description: params.description,
    });

    return report;
  }
}
