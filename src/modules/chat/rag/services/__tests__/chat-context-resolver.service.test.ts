import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatHistoryContextAttachment, ChatHistoryMessage } from '../../../models/chat-history.model.js';
import { ChatContextResolver } from '../chat-context-resolver.service.js';

const scope = {
  monitorId: 'monitor-1',
  subjectId: 'subject-1',
};

function studentMessage(contextAttachment?: ChatHistoryContextAttachment): ChatHistoryMessage {
  return {
    id: 'message-1',
    role: 'student',
    content: 'Pode explicar?',
    createdAt: new Date().toISOString(),
    questionContext: null,
    contextAttachment: contextAttachment ?? null,
  };
}

test('prioriza o anexo explícito de questão', async () => {
  const resolver = new ChatContextResolver();

  const result = await resolver.resolve({
    ...scope,
    explicitAttachment: { type: 'QUESTION', id: 'question-1', attemptId: 'attempt-1' },
    history: [],
  });

  assert.deepEqual(result, {
    type: 'QUESTION',
    id: 'question-1',
    attemptId: 'attempt-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
});

test('aceita o anexo explícito de flashcard no escopo atual', async () => {
  const resolver = new ChatContextResolver();

  const result = await resolver.resolve({
    ...scope,
    explicitAttachment: { type: 'FLASHCARD', id: 'flashcard-1' },
    history: [],
  });

  assert.deepEqual(result, {
    type: 'FLASHCARD',
    id: 'flashcard-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
});

test('recupera o último anexo compatível quando a nova mensagem não possui anexo', async () => {
  const resolver = new ChatContextResolver();

  const result = await resolver.resolve({
    ...scope,
    explicitAttachment: null,
    history: [
      studentMessage({
        type: 'QUESTION',
        id: 'question-old',
        monitorId: 'monitor-1',
        subjectId: 'subject-1',
      }),
      studentMessage({
        type: 'FLASHCARD',
        id: 'flashcard-last',
        monitorId: 'monitor-1',
        subjectId: 'subject-1',
      }),
    ],
  });

  assert.deepEqual(result, {
    type: 'FLASHCARD',
    id: 'flashcard-last',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
});

test('não herda anexo de outro monitor ou matéria', async () => {
  const resolver = new ChatContextResolver();

  const result = await resolver.resolve({
    ...scope,
    explicitAttachment: null,
    history: [studentMessage({
      type: 'QUESTION',
      id: 'question-other-scope',
      monitorId: 'monitor-other',
      subjectId: 'subject-other',
    })],
  });

  assert.equal(result, null);
});

test('retorna nenhum contexto quando não há anexo explícito nem histórico', async () => {
  const resolver = new ChatContextResolver();

  assert.equal(await resolver.resolve({
    ...scope,
    explicitAttachment: null,
    history: [],
  }), null);
});
