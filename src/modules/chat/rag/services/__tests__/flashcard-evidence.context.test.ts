import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlashcardEvidenceResult } from '../../models/flashcard-evidence.model.js';
import { buildFlashcardEvidenceContext } from '../flashcard-evidence.context.js';

const evidence: FlashcardEvidenceResult = {
  strategy: 'DIRECT_FLASHCARD_SOURCE',
  sufficient: true,
  flashcardId: 'flashcard-1',
  front: 'O que é aceleração?',
  back: 'É a variação da velocidade no tempo.',
  topicId: 'topic-1',
  citations: [{
    chunkId: 'chunk-1',
    documentId: 'document-1',
    blockId: 'block-1',
    content: 'A aceleração mede a variação da velocidade.',
    pageStart: 3,
    pageEnd: 3,
  }],
  context: '',
  metrics: { sourceCount: 1, chunkCount: 1, durationMs: 3 },
};

test('monta frente, verso e fontes do flashcard oficial', () => {
  const context = buildFlashcardEvidenceContext(evidence);

  assert.match(context, /\[FLASHCARD OFICIAL\]/);
  assert.match(context, /Frente: O que é aceleração/);
  assert.match(context, /Verso: É a variação/);
  assert.match(context, /A aceleração mede/);
  assert.match(context, /document-1/);
});

test('preserva o verso como fonte suficiente sem exigir citações documentais', () => {
  const context = buildFlashcardEvidenceContext({ ...evidence, citations: [] });

  assert.match(context, /Verso: É a variação da velocidade/);
  assert.doesNotMatch(context, /\[FONTES DO FLASHCARD\]/);
});
