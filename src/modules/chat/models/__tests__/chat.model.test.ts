import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageInputSchema } from '../chat.model.js';

test('aceita mensagem com escopo de chat e contexto de questão opcional', () => {
  const result = chatMessageInputSchema.safeParse({
    message: 'Explique esta questão',
    topicId: 'topic-1',
    questionContext: {
      questionId: 'question-1',
      questionAttemptId: 'attempt-1',
      statement: 'Quanto é 2 + 2?',
      selectedOption: 'B',
    },
  });

  assert.equal(result.success, true);
});

test('rejeita mensagem que excede o limite do contrato', () => {
  const result = chatMessageInputSchema.safeParse({ message: 'x'.repeat(8_001) });

  assert.equal(result.success, false);
});
