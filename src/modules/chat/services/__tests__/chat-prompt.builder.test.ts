import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatPromptBuilder } from '../chat-prompt.builder.js';

test('monta prompt com contexto autorizado, histórico e mensagem atual na ordem correta', () => {
  const builder = new ChatPromptBuilder();

  const messages = builder.build({
    message: 'Pode explicar passo a passo?',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    history: [
      {
        id: 'message-1',
        role: 'student',
        content: 'O que é força?',
        createdAt: '2026-09-07T12:00:00.000Z',
      },
      {
        id: 'message-2',
        role: 'assistant',
        content: 'Força é uma interação...',
        createdAt: '2026-09-07T12:00:01.000Z',
      },
    ],
    questionContext: {
      questionId: 'question-1',
      questionAttemptId: null,
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
      topicId: 'topic-1',
      number: 3,
      topic: 'Dinâmica',
      statement: 'Um corpo é submetido a uma força.',
      options: [{ label: 'A', text: '10 N' }],
      selectedOption: null,
    },
  });

  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /assistente pedagógico/i);
  assert.match(messages[0]?.content ?? '', /não revele dados internos/i);
  assert.equal(messages[1]?.role, 'user');
  assert.equal(messages[1]?.content, 'O que é força?');
  assert.equal(messages[2]?.role, 'assistant');
  assert.equal(messages[2]?.content, 'Força é uma interação...');
  assert.equal(messages[3]?.role, 'user');
  assert.match(messages[3]?.content ?? '', /CONTEXTO AUTORIZADO DA QUESTÃO/);
  assert.match(messages[3]?.content ?? '', /Dinâmica/);
  assert.match(messages[3]?.content ?? '', /Pode explicar passo a passo\?/);
  assert.doesNotMatch(messages[3]?.content ?? '', /student-1/);
});

test('monta prompt sem contexto de questão quando a mensagem é comum', () => {
  const builder = new ChatPromptBuilder();

  const messages = builder.build({
    message: 'Explique porcentagem.',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    history: [],
    questionContext: null,
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.role, 'user');
  assert.equal(messages[1]?.content, 'Explique porcentagem.');
  assert.doesNotMatch(messages[1]?.content ?? '', /CONTEXTO AUTORIZADO/);
});

test('usa contexto RAG já montado como conteúdo do usuário', () => {
  const messages = new ChatPromptBuilder().build({
    message: 'Explique.',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    history: [],
    questionContext: null,
    ragContext: '[EVIDÊNCIAS RECUPERADAS]\nA força é uma interação.',
  });

  assert.equal(messages[1]?.content, '[EVIDÊNCIAS RECUPERADAS]\nA força é uma interação.');
});
