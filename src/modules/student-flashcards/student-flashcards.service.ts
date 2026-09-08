import { calculateNextSrsState, type SrsState } from '../../services/srs.service.js';

export type FlashcardRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';

export interface FlashcardRepository {
  findFlashcard(flashcardId: string): Promise<{ id: string; monitorId: string } | null>;
  findProgress(input: { studentId: string; flashcardId: string }): Promise<SrsState | null>;
  saveProgress(input: {
    studentId: string;
    flashcardId: string;
    rating: FlashcardRating;
    repetitions: number;
    intervalDays: number;
    easeFactor: number;
    lastReviewedAt: Date;
    nextReviewAt: Date;
  }): Promise<{ repetitions: number; intervalDays: number; easeFactor: number; nextReviewAt: Date }>;
  createReviewLog(input: {
    studentId: string;
    flashcardId: string;
    rating: FlashcardRating;
    intervalDays: number;
    easeFactor: number;
    reviewedAt: Date;
    nextReviewAt: Date;
  }): Promise<void>;
}

export interface FlashcardAccess {
  assertMonitorAccess(input: { userId: string; monitorId: string }): Promise<{ studentId: string }>;
}

export class FlashcardNotFoundError extends Error {
  constructor() {
    super('FLASHCARD_NOT_FOUND');
  }
}

export function createStudentFlashcardsService(input: {
  access: FlashcardAccess;
  repository: FlashcardRepository;
}) {
  return {
    async reviewFlashcard(args: {
      userId: string;
      flashcardId: string;
      rating: FlashcardRating;
      now?: Date;
    }) {
      const flashcard = await input.repository.findFlashcard(args.flashcardId);
      if (!flashcard) throw new FlashcardNotFoundError();

      const { studentId } = await input.access.assertMonitorAccess({
        userId: args.userId,
        monitorId: flashcard.monitorId,
      });
      const now = args.now ?? new Date();
      const currentProgress = await input.repository.findProgress({ studentId, flashcardId: flashcard.id });
      const next = calculateNextSrsState(currentProgress, args.rating as Parameters<typeof calculateNextSrsState>[1], now);
      const progress = await input.repository.saveProgress({
        studentId,
        flashcardId: flashcard.id,
        rating: args.rating,
        ...next,
        lastReviewedAt: now,
      });
      await input.repository.createReviewLog({
        studentId,
        flashcardId: flashcard.id,
        rating: args.rating,
        intervalDays: next.intervalDays,
        easeFactor: next.easeFactor,
        reviewedAt: now,
        nextReviewAt: next.nextReviewAt,
      });
      return { flashcardId: flashcard.id, rating: args.rating, ...progress };
    },
  };
}
