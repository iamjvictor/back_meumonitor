import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentFlashcardsController } from '../student-flashcards.controller.js';

test('controller delega a revisão ao serviço', async () => {
  const calls: unknown[] = [];
  const controller = new StudentFlashcardsController({
    async reviewFlashcard(input) {
      calls.push(input);
      return { flashcardId: input.flashcardId, rating: input.rating };
    },
  });

  const result = await controller.reviewFlashcard({ userId: 'user-1', flashcardId: 'card-1', rating: 'GOOD' });

  assert.deepEqual(calls, [{ userId: 'user-1', flashcardId: 'card-1', rating: 'GOOD' }]);
  assert.deepEqual(result, { flashcardId: 'card-1', rating: 'GOOD' });
});
