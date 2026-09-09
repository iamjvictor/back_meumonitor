import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatService } from '../chat.service.js';
import type { ChatGenerationPort } from '../../ports/chat-generation.port.js';
import type { ChatHistoryMessage, ChatHistoryScope } from '../../models/chat-history.model.js';
import type { ChatHistoryPort } from '../../ports/chat-history.port.js';
import { ChatRagService } from '../../rag/services/chat-rag.service.js';
import type { ChatKnowledgePort } from '../../rag/ports/chat-knowledge.port.js';
import type { ChatRagInput } from '../../rag/models/chat-rag.model.js';

class InMemoryChatHistory implements ChatHistoryPort {
  messages: ChatHistoryMessage[] = [];
  listCalls = 0;

  async append(_scope: ChatHistoryScope, message: ChatHistoryMessage) {
    this.messages.push(message);
  }

  async list(_scope: ChatHistoryScope) {
    this.listCalls += 1;
    return this.messages;
  }

  async clear(_scope: ChatHistoryScope) {}
}

class FixedGeneration implements ChatGenerationPort {
  calls: Array<{ message: string; history: ChatHistoryMessage[]; ragContext?: string | null }> = [];

  async generate(input: { message: string; history: ChatHistoryMessage[] }) {
    this.calls.push(input);
    return { content: `Resposta para: ${input.message}` };
  }
}

class FixedKnowledge implements ChatKnowledgePort {
  calls: ChatRagInput[] = [];

  async retrieve(input: ChatRagInput) {
    this.calls.push(input);
    return {
      used: true,
      retrievalQuery: input.message,
      context: 'Evidência recuperada',
      citations: [],
      metrics: { candidateCount: 1, selectedCount: 1, durationMs: 1 },
    };
  }
}

test('lê o Redis, salva aluno, gera resposta e salva assistente no mesmo escopo', async () => {
  const history = new InMemoryChatHistory();
  const generation = new FixedGeneration();
  const knowledge = new FixedKnowledge();
  const service = new ChatService(history, generation, new ChatRagService(knowledge));
  const scope = { studentId: 'student-1', teacherId: 'teacher-1', monitorId: 'monitor-1', subjectId: 'subject-1' };

  const result = await service.sendMessage({ ...scope, message: 'Explique porcentagem.', questionContext: null });

  assert.equal(history.listCalls, 1);
  assert.deepEqual(generation.calls[0]?.history, []);
  assert.equal(generation.calls[0]?.ragContext?.includes('[DÚVIDA ATUAL DO ALUNO]'), true);
  assert.equal(knowledge.calls[0]?.teacherId, 'teacher-1');
  assert.deepEqual(history.messages.map((message) => message.role), ['student', 'assistant']);
  assert.equal(result.assistantMessage.content, 'Resposta para: Explique porcentagem.');
});

test('mantém a mensagem do aluno quando a geração falha, sem salvar assistente', async () => {
  const history = new InMemoryChatHistory();
  const generation: ChatGenerationPort = {
    async generate() {
      throw new Error('provider failed');
    },
  };
  const knowledge = new FixedKnowledge();
  const service = new ChatService(history, generation, new ChatRagService(knowledge));

  await assert.rejects(
    service.sendMessage({
      studentId: 'student-1',
      teacherId: 'teacher-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
      message: 'Explique.',
      questionContext: null,
    }),
    /provider failed/,
  );

  assert.deepEqual(history.messages.map((message) => message.role), ['student']);
});

test('continua a geração quando o serviço RAG falha', async () => {
  const history = new InMemoryChatHistory();
  const generation = new FixedGeneration();
  const knowledge: ChatKnowledgePort = {
    async retrieve() {
      throw new Error('retrieval unavailable');
    },
  };
  const service = new ChatService(history, generation, new ChatRagService(knowledge));

  const result = await service.sendMessage({
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    message: 'Explique sem evidências.',
    questionContext: null,
  });

  assert.equal(result.assistantMessage.content, 'Resposta para: Explique sem evidências.');
  assert.equal(generation.calls[0]?.ragContext?.includes('Nenhuma evidência relevante'), true);
  assert.deepEqual(history.messages.map((message) => message.role), ['student', 'assistant']);
});

test('rejeita mensagem vazia antes de acessar o Redis ou a IA', async () => {
  const history = new InMemoryChatHistory();
  const generation = new FixedGeneration();
  const service = new ChatService(history, generation, new ChatRagService(new FixedKnowledge()));

  await assert.rejects(
    service.sendMessage({
      studentId: 'student-1',
      teacherId: 'teacher-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
      message: '   ',
      questionContext: null,
    }),
    /CHAT_MESSAGE_REQUIRED/,
  );

  assert.equal(history.listCalls, 0);
  assert.equal(generation.calls.length, 0);
});

test('salva a referência explícita do anexo junto à mensagem do aluno', async () => {
  const history = new InMemoryChatHistory();
  const service = new ChatService(history, new FixedGeneration(), new ChatRagService(new FixedKnowledge()));

  await service.sendMessage({
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    message: 'Explique este card.',
    questionContext: null,
    contextAttachment: { type: 'FLASHCARD', id: 'flashcard-1' },
  });

  assert.deepEqual(history.messages[0]?.contextAttachment, {
    type: 'FLASHCARD',
    id: 'flashcard-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
});

test('herda a referência do último anexo compatível quando a nova mensagem não informa anexo', async () => {
  const history = new InMemoryChatHistory();
  const knowledge = new FixedKnowledge();
  history.messages.push({
    id: 'previous-message',
    role: 'student',
    content: 'O que significa?',
    createdAt: new Date().toISOString(),
    questionContext: null,
    contextAttachment: {
      type: 'QUESTION',
      id: 'question-1',
      attemptId: null,
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
    },
  });
  const service = new ChatService(history, new FixedGeneration(), new ChatRagService(knowledge));

  await service.sendMessage({
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    message: 'E essa parte?',
    questionContext: null,
  });

  assert.deepEqual(history.messages[1]?.contextAttachment, {
    type: 'QUESTION',
    id: 'question-1',
    attemptId: null,
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
  assert.equal(knowledge.calls[0]?.questionId, 'question-1');
});
