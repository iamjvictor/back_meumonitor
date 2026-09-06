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

function classifyFrontQuality(front: string): string | undefined {
  if (/^(?:f[oó]rmula|enunciado|defini[cç][aã]o|teorema|conceito|resumo|caracter[ií]sticas)\s+d[aeo]\b/u.test(front)) {
    return 'NOMINAL_FRONT';
  }
  if (/^(?:o que [eé]|qual [eé]|como se calcula)\s*(?:[?!.]|a formula\??|a defini[cç][aã]o\??|a resposta\??|a regra\??)?$/u.test(front)
    || /^(?:qual [eé])\s+(?:a|o)\s+(?:f[oó]rmula|defini[cç][aã]o|enunciado|regra)\??$/u.test(front)) {
    return 'VAGUE_FRONT';
  }
  if (/\b(?:explique tudo|tudo sobre|fale sobre|explique o assunto|explique a mat[eé]ria)\b/u.test(front)) {
    return 'MULTI_CONCEPT_FRONT';
  }
  if (/\b(?:acima|abaixo|anterior|seguinte|neste texto|no texto|na figura|figura acima|figura abaixo|o texto|a figura|isso|essa figura|esse caso|trecho|passagem|se[cç][aã]o)\b/u.test(front)
    || /\b(?:listad[ao]s?|anunciad[ao]s?|mencionad[ao]s?)\s+(?:no|na)\s+(?:trecho|passagem|se[cç][aã]o)\b/u.test(front)) {
    return 'CONTEXT_DEPENDENT_FRONT';
  }
  return undefined;
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
  const frontQualityReason = classifyFrontQuality(front);
  if (frontQualityReason) return { valid: false, reason: frontQualityReason };

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
