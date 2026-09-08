import { prisma } from '../../lib/prisma.js';
import type { FlashcardRating, FlashcardRepository } from './student-flashcards.service.js';

export class PrismaStudentFlashcardsRepository implements FlashcardRepository {
  async findFlashcard(flashcardId: string) {
    return prisma.flashcard.findUnique({ where: { id: flashcardId }, select: { id: true, monitorId: true } });
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
}
