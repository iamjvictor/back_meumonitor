export type FlashcardKind =
  | 'DEFINITION'
  | 'FORMULA'
  | 'RULE'
  | 'EXCEPTION'
  | 'APPLICATION';

export type FlashcardDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type FlashcardCandidate = {
  front: string;
  back: string;
  evidence?: string | string[];
  kind?: FlashcardKind;
  difficulty?: FlashcardDifficulty | null;
};

export type FlashcardValidationResult =
  | { valid: true }
  | { valid: false; reason: string };
