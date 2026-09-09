import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentFlashcardsController } from '../student-flashcards.controller.js';

test('controller delega a revisão ao serviço', async () => {
  const calls: unknown[] = [];
  const controller = new StudentFlashcardsController({
    async getRandomFlashcard() { return { id: 'card-1', monitorId: 'monitor-1', cardStatus: 'NEW' as const }; },
    async reviewFlashcard(input) {
      calls.push(input);
      return {
        flashcardId: input.flashcardId,
        rating: input.rating,
        repetitions: 1,
        intervalDays: 3,
        easeFactor: 2.5,
        nextReviewAt: new Date('2026-09-11T12:00:00.000Z'),
      };
    },
  });

  const result = await controller.reviewFlashcard({ userId: 'user-1', flashcardId: 'card-1', rating: 'GOOD' });

  assert.deepEqual(calls, [{ userId: 'user-1', flashcardId: 'card-1', rating: 'GOOD' }]);
  assert.deepEqual(result, {
    flashcardId: 'card-1',
    rating: 'GOOD',
    repetitions: 1,
    intervalDays: 3,
    easeFactor: 2.5,
    nextReviewAt: new Date('2026-09-11T12:00:00.000Z'),
  });
});
