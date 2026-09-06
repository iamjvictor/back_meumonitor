import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuestionCorrectness, studentQuestionAttemptSchema } from '../student-question-attempt.model.js';

test('accepts a practice answer and normalizes whitespace during correctness calculation', () => {
  const input = studentQuestionAttemptSchema.parse({
    questionId: '00000000-0000-4000-8000-000000000001',
    selectedAnswer: ' a ',
  });

  assert.equal(input.mode, 'PRACTICE');
  assert.equal(calculateQuestionCorrectness(input.selectedAnswer, 'A'), true);
});

test('marks a different alternative as incorrect', () => {
  assert.equal(calculateQuestionCorrectness('B', 'A'), false);
});

test('rejects an answer without a valid question id', () => {
  assert.throws(() => studentQuestionAttemptSchema.parse({ questionId: 'sample-1', selectedAnswer: 'A' }));
});
