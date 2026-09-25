import { prisma } from '../../lib/prisma.js';
import type { FlashcardRating, FlashcardRepository, RandomFlashcard } from './student-flashcards.service.js';

export class PrismaStudentFlashcardsRepository implements FlashcardRepository {
  private readonly cardInclude = {
    subject: { select: { id: true, name: true } },
    topic: { select: { id: true, name: true } },
    monitor: { select: { id: true, name: true } },
  } as const;

  async findFlashcard(flashcardId: string) {
    return prisma.flashcard.findFirst({ where: { id: flashcardId, status: 'APPROVED' }, select: { id: true, monitorId: true } });
  }

  async findProgress(input: { studentId: string; flashcardId: string }) {
    return prisma.studentFlashcardProgress.findUnique({
      where: { studentId_flashcardId: input },
      select: { repetitions: true, intervalDays: true, easeFactor: true },
    });
  }

  async saveProgress(input: {
    studentId: string;
    flashcardId: string;
    rating: FlashcardRating;
    repetitions: number;
    intervalDays: number;
    easeFactor: number;
    lastReviewedAt: Date;
    nextReviewAt: Date;
  }) {
    const { studentId, flashcardId, rating, ...data } = input;
    return prisma.studentFlashcardProgress.upsert({
      where: { studentId_flashcardId: { studentId, flashcardId } },
      update: { ...data, lastRating: rating },
      create: { studentId, flashcardId, ...data, lastRating: rating },
      select: { repetitions: true, intervalDays: true, easeFactor: true, nextReviewAt: true },
    });
  }

  async createReviewLog(input: {
    studentId: string;
    flashcardId: string;
    rating: FlashcardRating;
    intervalDays: number;
    easeFactor: number;
    reviewedAt: Date;
    nextReviewAt: Date;
  }) {
    await prisma.studentFlashcardReviewLog.create({ data: input });
  }

  async findDueCards(input: { studentId: string; monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]> {
    const rows = await prisma.studentFlashcardProgress.findMany({
      where: {
        studentId: input.studentId,
        nextReviewAt: { lte: new Date() },
        flashcard: { status: 'APPROVED', monitorId: { in: input.monitorIds }, ...(input.subjectId ? { subjectId: input.subjectId } : {}), ...(input.topicId ? { topicId: input.topicId } : {}), ...(input.excludeFlashcardId ? { id: { not: input.excludeFlashcardId } } : {}) },
      },
      orderBy: { nextReviewAt: 'asc' },
      include: { flashcard: { include: this.cardInclude } },
    });
    return rows.map(({ flashcard }) => ({ ...flashcard, cardStatus: 'DUE' as const }));
  }

  async findUnreviewedCards(input: { studentId: string; monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]> {
    const rows = await prisma.flashcard.findMany({
      where: {
        status: 'APPROVED',
        monitorId: { in: input.monitorIds },
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.topicId ? { topicId: input.topicId } : {}),
        ...(input.excludeFlashcardId ? { id: { not: input.excludeFlashcardId } } : {}),
        progresses: { none: { studentId: input.studentId } },
      },
      include: this.cardInclude,
    });
    return rows.map((card) => ({ ...card, cardStatus: 'NEW' as const }));
  }

  async findFallbackCards(input: { monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]> {
    const rows = await prisma.flashcard.findMany({
      where: { status: 'APPROVED', monitorId: { in: input.monitorIds }, ...(input.subjectId ? { subjectId: input.subjectId } : {}), ...(input.topicId ? { topicId: input.topicId } : {}), ...(input.excludeFlashcardId ? { id: { not: input.excludeFlashcardId } } : {}) },
      include: this.cardInclude,
      take: 50,
    });
    return rows.map((card) => ({ ...card, cardStatus: 'LEARNED' as const }));
  }
}
