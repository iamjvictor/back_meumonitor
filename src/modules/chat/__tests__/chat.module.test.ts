import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatModule } from '../chat.module.js';
import type { ChatAccessPort } from '../ports/chat-access.port.js';
import type { ChatGenerationPort } from '../ports/chat-generation.port.js';
import type { ChatHistoryMessage, ChatHistoryScope } from '../models/chat-history.model.js';
import type { ChatHistoryPort } from '../ports/chat-history.port.js';
import type { ChatKnowledgePort } from '../rag/ports/chat-knowledge.port.js';

class InMemoryHistory implements ChatHistoryPort {
  messages: ChatHistoryMessage[] = [];

  async append(_scope: ChatHistoryScope, message: ChatHistoryMessage) {
    this.messages.push(message);
  }

  async list(_scope: ChatHistoryScope) {
    return this.messages;
  }

  async clear(_scope: ChatHistoryScope) {
    this.messages = [];
  }
}

test('a entrada do módulo autoriza o usuário antes de executar o caso de uso', async () => {
  const accessCalls: Array<{ userId: string; monitorId: string; subjectId: string }> = [];
  const access: ChatAccessPort = {
    async resolveChatScope(input) {
      accessCalls.push(input);
      return {
        studentId: 'student-1',
        teacherId: 'teacher-1',
        monitorId: input.monitorId,
        subjectId: input.subjectId,
      };
    },
  };
  const knowledge: ChatKnowledgePort = {
    async retrieve(input) {
      return {
        used: false,
        retrievalQuery: input.message,
        context: '',
        citations: [],
        metrics: { candidateCount: 0, selectedCount: 0, durationMs: 0 },
      };
    },
  };
  const generation: ChatGenerationPort = {
    async generate(input) {
      return { content: `Resposta: ${input.message}` };
    },
  };
  const module = createChatModule({ access, history: new InMemoryHistory(), generation, knowledge });

  const result = await module.sendMessage({
    userId: 'user-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    message: 'Explique este conteúdo',
    questionContext: null,
  });

  assert.deepEqual(accessCalls, [{ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }]);
  assert.equal(result.assistantMessage.content, 'Resposta: Explique este conteúdo');
});

test('encerra o histórico somente após autorizar o escopo do usuário', async () => {
  const history = new InMemoryHistory();
  const accessCalls: Array<{ userId: string; monitorId: string; subjectId: string }> = [];
  const access: ChatAccessPort = {
    async resolveChatScope(input) {
      accessCalls.push(input);
      return {
        studentId: 'student-1',
        teacherId: 'teacher-1',
        monitorId: input.monitorId,
        subjectId: input.subjectId,
      };
    },
  };
  history.messages.push({
    id: 'message-1',
    role: 'student',
    content: 'mensagem temporária',
    createdAt: new Date().toISOString(),
    questionContext: null,
  });
  const module = createChatModule({
    access,
    history,
    generation: { async generate() { return { content: 'ok' }; } },
    knowledge: { async retrieve(input) {
      return { used: false, retrievalQuery: input.message, context: '', citations: [], metrics: { candidateCount: 0, selectedCount: 0, durationMs: 0 } };
    } },
  });

  await module.clearMessages({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' });

  assert.deepEqual(accessCalls, [{ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }]);
  assert.deepEqual(history.messages, []);
});
