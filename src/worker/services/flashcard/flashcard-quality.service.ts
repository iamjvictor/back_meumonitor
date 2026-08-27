import { createHash } from 'node:crypto';

import type {
  FlashcardCandidate,
  FlashcardValidationResult,
} from './flashcard.types.js';

const ELIGIBLE_BLOCK_TYPES = new Set(['THEORY', 'DEFINITION', 'FORMULA', 'EXAMPLE']);
const MIN_SOURCE_TEXT_LENGTH = 20;
const MIN_FRONT_LENGTH = 10;
const MAX_FRONT_LENGTH = 300;
const MIN_BACK_LENGTH = 2;
const MAX_BACK_LENGTH = 1500;

function normalizeText(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function getEvidence(candidate: FlashcardCandidate): string[] {
  if (candidate.evidence === undefined) return [];
  return Array.isArray(candidate.evidence) ? candidate.evidence : [candidate.evidence];
}

export function isFlashcardEligible(blockType: string, text: string): boolean {
  return ELIGIBLE_BLOCK_TYPES.has(blockType.trim().toUpperCase())
    && normalizeText(text).length >= MIN_SOURCE_TEXT_LENGTH;
}

export function validateFlashcardCandidate(
  candidate: FlashcardCandidate,
  sourceText: string,
): FlashcardValidationResult {
  const front = typeof candidate?.front === 'string' ? normalizeText(candidate.front) : '';
  const back = typeof candidate?.back === 'string' ? normalizeText(candidate.back) : '';

  if (!front || !back) return { valid: false, reason: 'EMPTY_CARD' };
  if (front.length < MIN_FRONT_LENGTH || front.length > MAX_FRONT_LENGTH) {
    return { valid: false, reason: 'INVALID_FRONT_LENGTH' };
  }
  if (back.length < MIN_BACK_LENGTH || back.length > MAX_BACK_LENGTH) {
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
  return createHash('sha256').update(normalizeText(front)).digest('hex');
}
