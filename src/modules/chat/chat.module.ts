import { ChatAuthorizationService } from './services/chat-authorization.service.js';
import {
  ChatService,
  type SendChatMessageInput,
  type SendChatMessageResult,
} from './services/chat.service.js';
import type { ChatAccessPort } from './ports/chat-access.port.js';
import type { ChatGenerationPort } from './ports/chat-generation.port.js';
import type { ChatHistoryPort } from './ports/chat-history.port.js';
import type { ChatKnowledgePort } from './rag/ports/chat-knowledge.port.js';
import type { ChatEvidenceCachePort } from './rag/ports/question-evidence.port.js';
import { ChatRagService } from './rag/services/chat-rag.service.js';

export type ChatModuleDependencies = {
  access: ChatAccessPort;
  history: ChatHistoryPort;
  generation: ChatGenerationPort;
  knowledge: ChatKnowledgePort;
  evidenceCache?: ChatEvidenceCachePort;
};

export type ChatModuleMessageInput = Omit<SendChatMessageInput, 'studentId' | 'teacherId'> & {
  userId: string;
};

export type ChatModuleHistoryInput = {
  userId: string;
  monitorId: string;
  subjectId: string;
};

/**
 * Composition root do domínio de chat dentro da API.
 *
 * O controller/adapter HTTP deve chamar esta fachada, em vez de instanciar
 * serviços internos. Quando o chat for extraído, esta interface poderá ser
 * substituída por um cliente HTTP sem alterar o contrato das rotas públicas.
 */
export class ChatModule {
  constructor(
    private readonly authorization: ChatAuthorizationService,
    private readonly chat: ChatService,
  ) {}

  async sendMessage(input: ChatModuleMessageInput): Promise<SendChatMessageResult> {
    const scope = await this.authorize({
      userId: input.userId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
    });

    return this.sendAuthorizedMessage(scope, input);
  }

  async listMessages(input: ChatModuleHistoryInput) {
    const scope = await this.authorize(input);
    return this.chat.listMessages(scope);
  }

  async clearMessages(input: ChatModuleHistoryInput) {
    const scope = await this.authorize(input);
    await this.chat.clearMessages(scope);
  }

  async authorize(input: {
    userId: string;
    monitorId: string;
    subjectId: string;
  }) {
    return this.authorization.authorize(input);
  }

  async sendAuthorizedMessage(
    scope: { studentId: string; teacherId: string; monitorId: string; subjectId: string },
    input: Omit<ChatModuleMessageInput, 'userId'>,
  ): Promise<SendChatMessageResult> {
    return this.chat.sendMessage({
      ...scope,
      requestId: input.requestId,
      contextAttachment: input.contextAttachment,
      questionEvidence: input.questionEvidence,
      flashcardEvidence: input.flashcardEvidence,
      message: input.message,
      questionContext: input.questionContext,
      historyLimit: input.historyLimit,
    });
  }
}

export function createChatModule(dependencies: ChatModuleDependencies) {
  return new ChatModule(
    new ChatAuthorizationService(dependencies.access),
    new ChatService(
      dependencies.history,
      dependencies.generation,
      new ChatRagService(dependencies.knowledge, undefined, undefined, dependencies.evidenceCache),
    ),
  );
}
