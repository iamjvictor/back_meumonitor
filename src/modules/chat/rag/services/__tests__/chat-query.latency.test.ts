import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRagInput } from '../../models/chat-rag.model.js';
import { ChatQueryBuilder } from '../chat-query.builder.js';

test('mantém a consulta semântica abaixo de 2.000 caracteres no caso comum', () => {
  const input: ChatRagInput = {
    message: 'Como aplico a segunda lei de Newton nesta situação?',
    history: [
      { id: 'student-1', role: 'student', content: 'Eu tentei usar força vezes massa.', createdAt: '2026-09-07T12:00:00.000Z' },
      { id: 'assistant-1', role: 'assistant', content: 'Observe primeiro quais grandezas são conhecidas.', createdAt: '2026-09-07T12:00:01.000Z' },
      { id: 'student-2', role: 'student', content: 'Ainda não sei qual força considerar.', createdAt: '2026-09-07T12:00:02.000Z' },
    ],
    questionContext: null,
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-dinamica',
  };

  const result = new ChatQueryBuilder().build(input);

  assert.ok(result.query.length <= 2_000);
  assert.match(result.query, /segunda lei de Newton/);
  assert.match(result.query, /topic-dinamica/);
  assert.match(result.query, /qual força considerar/);
});
