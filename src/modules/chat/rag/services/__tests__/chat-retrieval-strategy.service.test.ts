import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatRetrievalStrategyService } from '../chat-retrieval-strategy.service.js';

const strategy = new ChatRetrievalStrategyService();

test('seleciona fonte direta de questão e não gera embedding', () => {
  const result = strategy.choose({
    questionEvidence: { sufficient: true },
    flashcardEvidence: null,
    cacheHit: false,
  });

  assert.deepEqual(result, {
    strategy: 'DIRECT_QUESTION_SOURCE',
    shouldEmbed: false,
    reason: 'QUESTION_HAS_OFFICIAL_EVIDENCE',
  });
});

test('seleciona fonte direta de flashcard e não gera embedding', () => {
  const result = strategy.choose({
    questionEvidence: null,
    flashcardEvidence: { sufficient: true },
    cacheHit: false,
  });

  assert.deepEqual(result, {
    strategy: 'DIRECT_FLASHCARD_SOURCE',
    shouldEmbed: false,
    reason: 'FLASHCARD_HAS_OFFICIAL_EVIDENCE',
  });
});

test('prioriza cache de evidência antes do retrieval semântico', () => {
  const result = strategy.choose({
    questionEvidence: null,
    flashcardEvidence: null,
    cacheHit: true,
  });

  assert.deepEqual(result, {
    strategy: 'EVIDENCE_CACHE',
    shouldEmbed: false,
    reason: 'EVIDENCE_CACHE_HIT',
  });
});

test('seleciona retrieval semântico quando não há evidência direta nem cache', () => {
  const result = strategy.choose({
    questionEvidence: { sufficient: false },
    flashcardEvidence: { sufficient: false },
    cacheHit: false,
  });

  assert.deepEqual(result, {
    strategy: 'SEMANTIC_RETRIEVAL',
    shouldEmbed: true,
    reason: 'EVIDENCE_INSUFFICIENT',
  });
});
