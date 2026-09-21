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

test('reseta o escopo arquivando tentativas sem excluí-las', async () => {
  let resetInput: unknown;
  const repository = {
    findStudentByUserId: async () => ({ id: 'student-1' }),
    findAccessibleMonitorIds: async () => ['monitor-1', 'monitor-2'],
    archiveActiveAttempts: async (input: unknown) => {
      resetInput = input;
      return 3;
    },
  } as unknown as StudentQuestionAttemptRepository;

  const result = await new StudentQuestionAttemptService(repository).reset('user-1', {
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
  });

  assert.equal(result.archivedCount, 3);
  assert.deepEqual(resetInput, {
    studentId: 'student-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
    monitorIds: ['monitor-1', 'monitor-2'],
  });
});

test('não permite resetar um monitor ao qual o aluno não tem acesso', async () => {
  const repository = {
    findStudentByUserId: async () => ({ id: 'student-1' }),
    findAccessibleMonitorIds: async () => ['monitor-1'],
    archiveActiveAttempts: async () => 0,
  } as unknown as StudentQuestionAttemptRepository;

  await assert.rejects(
    () => new StudentQuestionAttemptService(repository).reset('user-1', { monitorId: 'monitor-2' }),
    /MONITOR_NOT_ACCESSIBLE/,
  );
});
