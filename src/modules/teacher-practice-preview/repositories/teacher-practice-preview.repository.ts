import { prisma } from '../../../lib/prisma.js';
import type { TeacherPracticePreviewFlashcard, TeacherPracticePreviewFlashcardFilters, TeacherPracticePreviewListResult } from '../services/teacher-practice-preview.service.js';

type QuestionFilters = {
  monitorId?: string;
  subjectId?: string;
  topicId?: string;
  page: number;
  pageSize: number;
};

export type TeacherPracticePreviewRepository = {
  findOwnedApprovedQuestions: (userId: string, input: QuestionFilters) => Promise<TeacherPracticePreviewListResult>;
  findOwnedApprovedQuestion: (userId: string, questionId: string) => Promise<{
    id: string;
    monitorId: string;
    correctAnswer: string | null;
    explanation: string | null;
  } | null>;
  findOwnedApprovedFlashcards: (userId: string, input: TeacherPracticePreviewFlashcardFilters) => Promise<TeacherPracticePreviewFlashcard[]>;
  findOwnedApprovedFlashcard: (userId: string, input: TeacherPracticePreviewFlashcardFilters & { flashcardId: string }) => Promise<{ id: string; monitorId: string } | null>;
};

export class PrismaTeacherPracticePreviewRepository implements TeacherPracticePreviewRepository {
  async findOwnedApprovedQuestions(userId: string, input: QuestionFilters) {
    const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
    if (!teacher) throw new Error('TEACHER_NOT_FOUND');

    const where = {
      status: 'APPROVED' as const,
      monitor: { teacherId: teacher.id },
      ...(input.monitorId ? { monitorId: input.monitorId } : {}),
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      ...(input.topicId ? { topicId: input.topicId } : {}),
    };

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          monitorId: true,
          subjectId: true,
          topicId: true,
          text: true,
          alternatives: true,
          kind: true,
          difficulty: true,
          explanation: true,
          questionBankItem: { select: { imageUrls: true } },
          subject: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
        },
      }),
      prisma.question.count({ where }),
    ]);

    return {
      questions,
      total,
      stats: { attemptsCount: 0, correctCount: 0, answeredQuestionsCount: 0, accuracy: 0 },
    };
  }

  async findOwnedApprovedQuestion(userId: string, questionId: string) {
    const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
    if (!teacher) throw new Error('TEACHER_NOT_FOUND');

    return prisma.question.findFirst({
      where: { id: questionId, status: 'APPROVED', monitor: { teacherId: teacher.id } },
      select: { id: true, monitorId: true, correctAnswer: true, explanation: true },
    });
  }

  private async findTeacherId(userId: string) {
    const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
    if (!teacher) throw new Error('TEACHER_NOT_FOUND');
    return teacher.id;
  }

  async findOwnedApprovedFlashcards(userId: string, input: TeacherPracticePreviewFlashcardFilters) {
    const teacherId = await this.findTeacherId(userId);
    return prisma.flashcard.findMany({
      where: {
        status: 'APPROVED',
        monitor: { teacherId },
        ...(input.monitorId ? { monitorId: input.monitorId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.topicId ? { topicId: input.topicId } : {}),
        ...(input.excludeFlashcardId ? { id: { not: input.excludeFlashcardId } } : {}),
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        monitorId: true,
        subjectId: true,
        topicId: true,
        front: true,
        back: true,
        subject: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        monitor: { select: { id: true, name: true } },
      },
    });
  }

  async findOwnedApprovedFlashcard(userId: string, input: TeacherPracticePreviewFlashcardFilters & { flashcardId: string }) {
    const teacherId = await this.findTeacherId(userId);
    return prisma.flashcard.findFirst({
      where: { id: input.flashcardId, status: 'APPROVED', monitor: { teacherId } },
      select: { id: true, monitorId: true },
    });
  }
}
