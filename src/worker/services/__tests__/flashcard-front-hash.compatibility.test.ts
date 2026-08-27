import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFlashcardFrontHash } from '../flashcard/flashcard-quality.service.js';
import { normalizeFlashcardFront } from '../../../services/flashcard-front-hash.js';

test('shared normalization produces one hash for Unicode whitespace variants', () => {
  const variants = ['  Crase\u00a0em português  ', 'crase em   português', 'CRASE EM PORTUGUÊS'];
  assert.equal(new Set(variants.map(normalizeFlashcardFront)).size, 1);
  assert.equal(new Set(variants.map(computeFlashcardFrontHash)).size, 1);
});
