import { calculateNextSrsState, type SrsState } from '../../services/srs.service.js';
import { pickRandomAvailable } from '../../services/flashcard-selection.js';

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
  findDueCards?(input: { studentId: string; monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]>;
  findUnreviewedCards?(input: { studentId: string; monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]>;
  findFallbackCards?(input: { monitorIds: string[]; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard[]>;
}

export interface FlashcardAccess {
  assertMonitorAccess(input: { userId: string; monitorId: string }): Promise<{ studentId: string }>;
  getAccessibleMonitorIds?(input: { userId: string }): Promise<{ studentId: string; monitorIds: string[] }>;
}

export interface RandomFlashcard {
  id: string;
  monitorId: string;
  cardStatus: 'DUE' | 'NEW' | 'LEARNED';
  [key: string]: unknown;
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
    async getRandomFlashcard(args: { userId: string; monitorId?: string; subjectId?: string; topicId?: string; excludeFlashcardId?: string }): Promise<RandomFlashcard> {
      let studentId: string;
      let monitorIds: string[];
      if (args.monitorId) {
        ({ studentId } = await input.access.assertMonitorAccess({ userId: args.userId, monitorId: args.monitorId }));
        monitorIds = [args.monitorId];
      } else {
        if (!input.access.getAccessibleMonitorIds) throw new Error('NO_ACCESSIBLE_MONITORS');
        ({ studentId, monitorIds } = await input.access.getAccessibleMonitorIds({ userId: args.userId }));
        if (monitorIds.length === 0) throw new Error('NO_ACCESSIBLE_MONITORS');
      }

      const filter = {
        ...(args.subjectId ? { subjectId: args.subjectId } : {}),
        ...(args.topicId ? { topicId: args.topicId } : {}),
        ...(args.excludeFlashcardId ? { excludeFlashcardId: args.excludeFlashcardId } : {}),
      };
      const due = await input.repository.findDueCards?.({ studentId, monitorIds, ...filter }) ?? [];
      const dueCard = pickRandomAvailable(due, args.excludeFlashcardId);
      if (dueCard) return dueCard;

      const fresh = await input.repository.findUnreviewedCards?.({ studentId, monitorIds, ...filter }) ?? [];
      const freshCard = pickRandomAvailable(fresh, args.excludeFlashcardId);
      if (freshCard) return freshCard;

      const fallback = await input.repository.findFallbackCards?.({ monitorIds, ...filter }) ?? [];
      const fallbackCard = pickRandomAvailable(fallback, args.excludeFlashcardId);
      if (fallbackCard) return fallbackCard;

      throw new Error('NO_FLASHCARDS_FOUND');
    },

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
