import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLASHCARD_MAX_BACK_LENGTH,
  FLASHCARD_MAX_FRONT_LENGTH,
  FLASHCARD_MIN_BACK_LENGTH,
  FLASHCARD_MIN_FRONT_LENGTH,
  FLASHCARD_MIN_SOURCE_TEXT_LENGTH,
  computeFlashcardFrontHash,
  isFlashcardEligible,
  validateFlashcardCandidate,
} from '../flashcard/flashcard-quality.service.js';
import { normalizeFlashcardFront } from '../../../services/flashcard-front-hash.js';

const sourceText = 'A fotossíntese é o processo pelo qual plantas convertem energia luminosa em energia química.';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    front: 'O que é fotossíntese?',
    back: 'É o processo pelo qual plantas convertem luz em energia química.',
    evidence: ['A fotossíntese é o processo pelo qual plantas convertem energia luminosa em energia química.'],
    ...overrides,
  };
}

test('accepts conceptual block types with meaningful content', () => {
  const text = 'A fotossíntese converte energia luminosa em energia química nas plantas.';

  for (const type of ['THEORY', 'DEFINITION', 'FORMULA', 'EXAMPLE']) {
    assert.equal(isFlashcardEligible(type, text), true, type);
  }
});

test('accepts QUESTION blocks with meaningful content', () => {
  assert.equal(isFlashcardEligible('QUESTION', 'Por que a fotossíntese é importante para as plantas?'), true);
});

test('rejects unsupported block types and short content', () => {
  assert.equal(isFlashcardEligible('TITLE', 'Uma pergunta conceitual suficientemente longa?'), false);
  assert.equal(isFlashcardEligible('THEORY', 'curto'), false);
  assert.equal(isFlashcardEligible('THEORY', '   '), false);
});

test('rejects empty cards', () => {
  const result = validateFlashcardCandidate(candidate({ front: '', back: '' }), sourceText);

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'EMPTY_CARD');
});

test('rejects a card whose front equals its back after normalization', () => {
  const result = validateFlashcardCandidate(
    candidate({ front: '  O que é fotossíntese? ', back: 'o QUE é FOTOSSÍNTESE?' }),
    sourceText,
  );

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'FRONT_EQUALS_BACK');
});

test('rejects candidates without source evidence', () => {
  const result = validateFlashcardCandidate(candidate({ evidence: [] }), sourceText);

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'MISSING_EVIDENCE');
});

test('rejects evidence that is not grounded in the source text', () => {
  const result = validateFlashcardCandidate(
    candidate({ evidence: ['A fotossíntese acontece somente à noite.'] }),
    sourceText,
  );

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'UNGROUNDED_EVIDENCE');
});

test('accepts a non-empty candidate with grounded evidence', () => {
  assert.deepEqual(validateFlashcardCandidate(candidate(), sourceText), { valid: true });
});

test('computes the same hash for equivalent normalized fronts', () => {
  assert.equal(
    computeFlashcardFrontHash('  O que é   fotossíntese? '),
    computeFlashcardFrontHash('o QUE é fotossíntese?'),
  );
});

test('uses the shared front normalization for Unicode and whitespace compatibility', () => {
  const first = '  O que é\u00a0fotossíntese?\n';
  const second = 'o que é   fotossíntese?';

  assert.equal(normalizeFlashcardFront(first), normalizeFlashcardFront(second));
  assert.equal(computeFlashcardFrontHash(first), computeFlashcardFrontHash(second));
});

test('accepts the documented source and card length boundaries', () => {
  const source = 'x'.repeat(FLASHCARD_MIN_SOURCE_TEXT_LENGTH);
  assert.equal(isFlashcardEligible('THEORY', source), true);
  assert.equal(isFlashcardEligible('THEORY', 'x'.repeat(FLASHCARD_MIN_SOURCE_TEXT_LENGTH - 1)), false);

  const result = validateFlashcardCandidate({
    front: 'f'.repeat(FLASHCARD_MIN_FRONT_LENGTH),
    back: 'b'.repeat(FLASHCARD_MIN_BACK_LENGTH),
    evidence: [source],
  }, source);
  assert.deepEqual(result, { valid: true });

  assert.deepEqual(validateFlashcardCandidate({
    front: 'f'.repeat(FLASHCARD_MAX_FRONT_LENGTH),
    back: 'valid back',
    evidence: [source],
  }, source), { valid: true });
  assert.deepEqual(validateFlashcardCandidate({
    front: 'valid front',
    back: 'b'.repeat(FLASHCARD_MAX_BACK_LENGTH),
    evidence: [source],
  }, source), { valid: true });

  const overlongFront = validateFlashcardCandidate({
    front: 'f'.repeat(FLASHCARD_MAX_FRONT_LENGTH + 1),
    back: 'valid back',
    evidence: [source],
  }, source);
  assert.equal(overlongFront.valid, false);
  if (!overlongFront.valid) assert.equal(overlongFront.reason, 'INVALID_FRONT_LENGTH');

  const overlongBack = validateFlashcardCandidate({
    front: 'valid front',
    back: 'b'.repeat(FLASHCARD_MAX_BACK_LENGTH + 1),
    evidence: [source],
  }, source);
  assert.equal(overlongBack.valid, false);
  if (!overlongBack.valid) assert.equal(overlongBack.reason, 'INVALID_BACK_LENGTH');
});
