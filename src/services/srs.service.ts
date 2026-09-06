import { FlashcardRating } from '@prisma/client';

export interface SrsState {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
}

export interface SrsResult extends SrsState {
  nextReviewAt: Date;
}

const TEN_MINUTES_IN_DAYS = 10 / 1440; // ~0.00694 days

/**
 * Calculates the next SRS state based on user-defined interval rules:
 * 
 * | Rating | Texto para o aluno | Novo card | Card já em revisão |
 * | AGAIN  | Não lembrei        | 10 min    | 10 min             |
 * | HARD   | Foi difícil        | 1 dia     | 2 dias             |
 * | GOOD   | Lembrei            | 3 dias    | 6 dias             |
 * | EASY   | Muito fácil        | 6 dias    | 12 dias            |
 */
export function calculateNextSrsState(
  currentState: SrsState | null | undefined,
  rating: FlashcardRating,
  now: Date = new Date()
): SrsResult {
  const currentEase = currentState?.easeFactor ?? 2.5;
  const currentInterval = currentState?.intervalDays ?? 0;
  const currentReps = currentState?.repetitions ?? 0;

  const isNewCard = currentReps === 0;

  let newReps = currentReps;
  let newInterval = currentInterval;
  let newEase = currentEase;

  switch (rating) {
    case 'AGAIN': {
      // "Não lembrei": Reset repetitions, interval = 10 min
      newReps = 0;
      newInterval = TEN_MINUTES_IN_DAYS;
      newEase = Math.max(1.3, currentEase - 0.2);
      break;
    }

    case 'HARD': {
      // "Foi difícil": Novo = 1 dia, Em revisão = 2 dias (ou progressivo a partir de 2d)
      newReps = currentReps + 1;
      if (isNewCard) {
        newInterval = 1;
      } else {
        newInterval = Math.max(2, currentInterval * 1.2);
      }
      newEase = Math.max(1.3, currentEase - 0.15);
      break;
    }

    case 'GOOD': {
      // "Lembrei": Novo = 3 dias, Em revisão = 6 dias (ou progressivo a partir de 6d)
      newReps = currentReps + 1;
      if (isNewCard) {
        newInterval = 3;
      } else {
        newInterval = Math.max(6, currentInterval * currentEase);
      }
      break;
    }

    case 'EASY': {
      // "Muito fácil": Novo = 6 dias, Em revisão = 12 dias (ou progressivo a partir de 12d)
      newReps = currentReps + 1;
      if (isNewCard) {
        newInterval = 6;
      } else {
        newInterval = Math.max(12, currentInterval * currentEase * 1.3);
      }
      newEase = currentEase + 0.15;
      break;
    }
  }

  // Calculate next review date
  const nextReviewMs = now.getTime() + Math.round(newInterval * 24 * 60 * 60 * 1000);
  const nextReviewAt = new Date(nextReviewMs);

  return {
    repetitions: newReps,
    intervalDays: Math.round(newInterval * 10000) / 10000,
    easeFactor: Math.round(newEase * 100) / 100,
    nextReviewAt,
  };
}
