import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudentFlashcardsService } from '../student-flashcards.service.js';

test('revisa flashcard autorizado e persiste progresso e log SRS', async () => {
  const calls: string[] = [];
  const service = createStudentFlashcardsService({
    access: { async assertMonitorAccess() { return { studentId: 'student-1' }; } },
    repository: {
      async findFlashcard() { return { id: 'card-1', monitorId: 'monitor-1' }; },
      async findProgress() { return null; },
      async saveProgress(input) { calls.push(`progress:${input.repetitions}:${input.intervalDays}`); return input; },
      async createReviewLog(input) { calls.push(`log:${input.rating}`); },
    },
  });

  const result = await service.reviewFlashcard({
    userId: 'user-1',
    flashcardId: 'card-1',
    rating: 'GOOD',
    now: new Date('2026-09-08T12:00:00.000Z'),
  });

  assert.deepEqual(calls, ['progress:1:3', 'log:GOOD']);
  assert.equal(result.repetitions, 1);
  assert.equal(result.intervalDays, 3);
});

test('rejeita revisão quando flashcard não existe', async () => {
  const service = createStudentFlashcardsService({
    access: { async assertMonitorAccess() { return { studentId: 'student-1' }; } },
    repository: {
      async findFlashcard() { return null; },
      async findProgress() { return null; },
      async saveProgress(input) { return input; },
      async createReviewLog() {},
    },
  });

  await assert.rejects(service.reviewFlashcard({
    userId: 'user-1', flashcardId: 'missing', rating: 'GOOD',
  }), /FLASHCARD_NOT_FOUND/);
});

test('seleciona primeiro um flashcard vencido', async () => {
  const service = createStudentFlashcardsService({
    access: {
      async assertMonitorAccess() { return { studentId: 'student-1' }; },
      async getAccessibleMonitorIds() { return { studentId: 'student-1', monitorIds: ['monitor-1'] }; },
    },
    repository: {
      async findFlashcard() { return null; },
      async findProgress() { return null; },
      async saveProgress(input) { return input; },
      async createReviewLog() {},
      async findDueCards() { return [{ id: 'due-1', monitorId: 'monitor-1', cardStatus: 'DUE' as const }]; },
      async findUnreviewedCards() { return []; },
      async findFallbackCards() { return []; },
    },
  });

  const result = await service.getRandomFlashcard({ userId: 'user-1' });

  assert.deepEqual(result, { id: 'due-1', monitorId: 'monitor-1', cardStatus: 'DUE' });
});

test('rejeita monitor solicitado sem acesso', async () => {
  const service = createStudentFlashcardsService({
    access: {
      async assertMonitorAccess() { throw new Error('MONITOR_NOT_ACCESSIBLE'); },
      async getAccessibleMonitorIds() { return { studentId: 'student-1', monitorIds: ['monitor-1'] }; },
    },
    repository: {
      async findFlashcard() { return null; },
      async findProgress() { return null; },
      async saveProgress(input) { return input; },
      async createReviewLog() {},
      async findDueCards() { return []; },
      async findUnreviewedCards() { return []; },
      async findFallbackCards() { return []; },
    },
  });

  await assert.rejects(service.getRandomFlashcard({ userId: 'user-1', monitorId: 'monitor-2' }), /MONITOR_NOT_ACCESSIBLE/);
});
