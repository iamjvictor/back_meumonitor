import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentQuestionAttemptService } from '../student-question-attempt.service.js';
import type { StudentQuestionAttemptRepository } from '../../repositories/student-question-attempt.repository.js';

test('registra a tentativa sem fazer lookup antecipado de idempotência', async () => {
  let idempotencyLookupCalled = false;

  const repository = {
    findStudentByUserId: async () => ({ id: 'student-1' }),
    findAccessibleMonitorIds: async () => ['monitor-1'],
    findApprovedQuestion: async () => ({
      id: 'question-1',
      monitorId: 'monitor-1',
      correctAnswer: 'A',
      explanation: 'A alternativa A está correta.',
    }),
    findByIdempotencyKey: async () => {
      idempotencyLookupCalled = true;
      throw new Error('lookup antecipado não deveria ocorrer');
    },
    createPracticeAttempt: async () => ({
      id: 'attempt-1',
      isCorrect: true,
      mode: 'PRACTICE',
    }),
  } as unknown as StudentQuestionAttemptRepository;

  const result = await new StudentQuestionAttemptService(repository).answer('user-1', {
    questionId: 'question-1',
    selectedAnswer: 'A',
    mode: 'PRACTICE',
    idempotencyKey: 'key-1',
  });

  assert.equal(idempotencyLookupCalled, false);
  assert.equal(result.isCorrect, true);
  assert.equal(result.correctAnswer, 'A');
  assert.equal(result.explanation, 'A alternativa A está correta.');
});
