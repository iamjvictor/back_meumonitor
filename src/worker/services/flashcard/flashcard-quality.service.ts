import type {
  FlashcardCandidate,
  FlashcardValidationResult,
} from './flashcard.types.js';
import {
  computeFlashcardFrontHash as computeSharedFlashcardFrontHash,
  normalizeFlashcardFront,
} from '../../../services/flashcard-front-hash.js';

/** Minimum normalized content length for a source block to be considered meaningful. */
export const FLASHCARD_MIN_SOURCE_TEXT_LENGTH = 20;
/** Inclusive normalized front length limits, matching the generation schema. */
export const FLASHCARD_MIN_FRONT_LENGTH = 10;
export const FLASHCARD_MAX_FRONT_LENGTH = 300;
/** Inclusive normalized back length limits, matching the generation schema. */
export const FLASHCARD_MIN_BACK_LENGTH = 2;
export const FLASHCARD_MAX_BACK_LENGTH = 1500;

const ELIGIBLE_BLOCK_TYPES = new Set(['THEORY', 'DEFINITION', 'FORMULA', 'EXAMPLE', 'QUESTION']);

function normalizeText(value: string) {
  return normalizeFlashcardFront(value);
}

function getEvidence(candidate: FlashcardCandidate): string[] {
  if (candidate.evidence === undefined) return [];
  return Array.isArray(candidate.evidence) ? candidate.evidence : [candidate.evidence];
}

export function isFlashcardEligible(blockType: string, text: string): boolean {
  return ELIGIBLE_BLOCK_TYPES.has(blockType.trim().toUpperCase())
    && normalizeText(text).length >= FLASHCARD_MIN_SOURCE_TEXT_LENGTH;
}

export function validateFlashcardCandidate(
  candidate: FlashcardCandidate,
  sourceText: string,
): FlashcardValidationResult {
  const front = typeof candidate?.front === 'string' ? normalizeText(candidate.front) : '';
  const back = typeof candidate?.back === 'string' ? normalizeText(candidate.back) : '';

  if (!front || !back) return { valid: false, reason: 'EMPTY_CARD' };
  if (front.length < FLASHCARD_MIN_FRONT_LENGTH || front.length > FLASHCARD_MAX_FRONT_LENGTH) {
    return { valid: false, reason: 'INVALID_FRONT_LENGTH' };
  }
  if (back.length < FLASHCARD_MIN_BACK_LENGTH || back.length > FLASHCARD_MAX_BACK_LENGTH) {
    return { valid: false, reason: 'INVALID_BACK_LENGTH' };
  }
  if (front === back) return { valid: false, reason: 'FRONT_EQUALS_BACK' };

  const evidence = getEvidence(candidate)
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeText)
    .filter(Boolean);
  if (evidence.length === 0) return { valid: false, reason: 'MISSING_EVIDENCE' };

  const normalizedSource = normalizeText(sourceText);
  if (!normalizedSource || evidence.some((item) => !normalizedSource.includes(item))) {
    return { valid: false, reason: 'UNGROUNDED_EVIDENCE' };
  }

  return { valid: true };
}

export function computeFlashcardFrontHash(front: string): string {
  return computeSharedFlashcardFrontHash(front);
}
