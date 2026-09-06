import assert from 'node:assert/strict';
import test from 'node:test';

import { getBlockEligibility, getInitialChunkStatus, type BlockForChunking } from '../chunk.service.js';

function questionBlock(overrides: Partial<BlockForChunking> = {}): BlockForChunking {
  return {
    id: 'block-1',
    blockIndex: 1,
    type: 'QUESTION',
    title: null,
    normalizedContent: '1. Uma escola recebeu 120 livros. Quantos livros restaram após a distribuição?',
    isComplete: true,
    incompleteReason: null,
    sectionPath: [],
    questionNumber: '1',
    institution: null,
    examYear: null,
    pageStart: 1,
    pageEnd: 1,
    topicLinks: [],
    ...overrides,
  };
}

test('preserva questão incompleta recuperável para receber contexto e completar por IA', () => {
  const eligibility = getBlockEligibility(questionBlock({
    isComplete: false,
    incompleteReason: 'QUESTION_MATH_LAYOUT_CORRUPTED',
  }));

  assert.deepEqual(eligibility, { eligible: true });
});

test('continua excluindo blocos incompletos que não são questões', () => {
  const eligibility = getBlockEligibility(questionBlock({
    type: 'THEORY',
    isComplete: false,
  }));

  assert.deepEqual(eligibility, { eligible: false, reason: 'INVALID_QUESTION' });
});

test('mantém todo chunk persistido pendente até possuir embedding', () => {
  assert.equal(getInitialChunkStatus(), 'EMBEDDING_PENDING');
});
