import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeFlashcardFrontHash,
  isFlashcardEligible,
  validateFlashcardCandidate,
} from '../flashcard/flashcard-quality.service.js';

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

test('rejects unsupported block types and short content', () => {
  assert.equal(isFlashcardEligible('QUESTION', 'Uma pergunta conceitual suficientemente longa?'), false);
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
