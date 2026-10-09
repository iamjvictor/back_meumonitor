import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldExtractQuestionsForDocument } from '../document-worker.service.js';

test('somente documentos com tag QUESTIONS extraem questões automaticamente', () => {
  assert.equal(shouldExtractQuestionsForDocument('KNOWLEDGE_BASE'), false);
  assert.equal(shouldExtractQuestionsForDocument('QUESTIONS'), true);
  assert.equal(shouldExtractQuestionsForDocument('FLASHCARDS'), false);
});
