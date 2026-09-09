import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatAuthorizationService } from '../chat-authorization.service.js';
import type { ChatAccessPort } from '../../ports/chat-access.port.js';

test('resolve o escopo autorizado do aluno para o chat', async () => {
  const access: ChatAccessPort = {
    resolveChatScope: async () => ({
      studentId: 'student-1',
      teacherId: 'teacher-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
    }),
  };

  const result = await new ChatAuthorizationService(access).authorize({
    userId: 'user-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.deepEqual(result, {
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
});

test('rejeita chat quando o aluno não possui acesso ao escopo', async () => {
  const access: ChatAccessPort = { resolveChatScope: async () => null };

  await assert.rejects(
    new ChatAuthorizationService(access).authorize({
      userId: 'user-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
    }),
    /CHAT_ACCESS_DENIED/,
  );
});
