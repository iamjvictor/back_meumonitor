import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatQueryBuilder } from '../chat-query.builder.js';
import type { ChatRagInput } from '../../models/chat-rag.model.js';

function makeInput(history: ChatRagInput['history']): ChatRagInput {
  return {
    message: 'E nessa questão, qual é o próximo passo?',
    history,
    questionContext: {
      questionId: 'question-secret-id',
      questionAttemptId: 'attempt-secret-id',
      monitorId: 'monitor-secret-id',
      subjectId: 'subject-secret-id',
      topicId: 'topic-secret-id',
      number: 19,
      topic: 'Razão e proporção',
      statement: 'Uma grandeza é diretamente proporcional a outra.',
      options: [{ label: 'A', text: 'A razão permanece constante.' }],
      selectedOption: 'A',
    },
    studentId: 'student-secret-id',
    teacherId: 'teacher-secret-id',
    monitorId: 'monitor-secret-id',
    subjectId: 'subject-secret-id',
    topicId: 'topic-secret-id',
  };
}

test('seleciona somente as últimas duas mensagens para montar a consulta RAG', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? 'student' as const : 'assistant' as const,
    content: `mensagem histórica ${index + 1}`,
    createdAt: `2026-09-07T12:0${index}:00.000Z`,
  }));

  const result = new ChatQueryBuilder().build(makeInput(history));

  assert.deepEqual(result.history.map((message) => message.content), [
    'mensagem histórica 7',
    'mensagem histórica 8',
  ]);
});

test('monta consulta com tópico sem expor IDs internos nem o enunciado completo', () => {
  const result = new ChatQueryBuilder().build(makeInput([]));

  assert.match(result.query, /Razão e proporção/);
  assert.match(result.query, /E nessa questão/);
  assert.doesNotMatch(result.query, /Uma grandeza é diretamente proporcional/);
  assert.doesNotMatch(result.query, /question-secret-id|attempt-secret-id|student-secret-id/);
  assert.doesNotMatch(result.query, /teacher-secret-id|monitor-secret-id|subject-secret-id|topic-secret-id/);
});

test('limita o tamanho da consulta sem remover a dúvida atual', () => {
  const result = new ChatQueryBuilder().build(makeInput([]));

  assert.ok(result.query.length <= 2_000);
  assert.match(result.query, /E nessa questão, qual é o próximo passo\?/);
});

test('usa somente mensagem atual, tópico e no máximo duas mensagens anteriores', () => {
  const result = new ChatQueryBuilder().build(makeInput([
    { id: 'old-1', role: 'student', content: 'não usar 1', createdAt: '2026-09-07T12:00:00.000Z' },
    { id: 'old-2', role: 'assistant', content: 'não usar 2', createdAt: '2026-09-07T12:00:01.000Z' },
    { id: 'recent-1', role: 'student', content: 'usar 1', createdAt: '2026-09-07T12:00:02.000Z' },
    { id: 'recent-2', role: 'assistant', content: 'usar 2', createdAt: '2026-09-07T12:00:03.000Z' },
  ]));

  assert.ok(result.query.length <= 2_000);
  assert.match(result.query, /Razão e proporção/);
  assert.match(result.query, /usar 1/);
  assert.match(result.query, /usar 2/);
  assert.doesNotMatch(result.query, /não usar 1|não usar 2/);
  assert.doesNotMatch(result.query, /Uma grandeza é diretamente proporcional/);
});
