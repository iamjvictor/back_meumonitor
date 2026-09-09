import assert from 'node:assert/strict';
import test from 'node:test';
import { isQuestionEvidenceSufficient } from '../../models/question-evidence.model.js';

test('considera suficiente uma resposta oficial com confiança mínima', () => {
  assert.equal(isQuestionEvidenceSufficient({
    correctAnswer: 'C',
    correctAnswerConfidence: 0.8,
    sources: [],
  }), true);
});

test('considera suficiente uma fonte oficial pronta de gabarito ou explicação', () => {
  assert.equal(isQuestionEvidenceSufficient({
    correctAnswer: null,
    correctAnswerConfidence: null,
    sources: [{ role: 'ANSWER_KEY', chunkStatus: 'READY' }],
  }), true);

  assert.equal(isQuestionEvidenceSufficient({
    correctAnswer: null,
    correctAnswerConfidence: null,
    sources: [{ role: 'EXPLANATION', chunkStatus: 'READY' }],
  }), true);
});

test('considera insuficiente uma questão que possui somente a fonte do enunciado', () => {
  assert.equal(isQuestionEvidenceSufficient({
    correctAnswer: null,
    correctAnswerConfidence: null,
    sources: [{ role: 'STATEMENT', chunkStatus: 'READY' }],
  }), false);
});

test('não considera suficiente uma fonte oficial cujo chunk ainda não está pronto', () => {
  assert.equal(isQuestionEvidenceSufficient({
    correctAnswer: null,
    correctAnswerConfidence: null,
    sources: [{ role: 'ANSWER_KEY', chunkStatus: 'EMBEDDING_PENDING' }],
  }), false);
});
