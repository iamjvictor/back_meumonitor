import type { ChatHistoryMessage } from '../../models/chat-history.model.js';
import type { ChatContextAttachment } from '../../models/chat.model.js';

export type ChatResolvedContext = {
  type: 'QUESTION' | 'FLASHCARD';
  id: string;
  attemptId?: string | null;
  monitorId: string;
  subjectId: string;
};

export type ChatContextResolverInput = {
  monitorId: string;
  subjectId: string;
  explicitAttachment?: ChatContextAttachment | null;
  history: ChatHistoryMessage[];
};

export class ChatContextResolver {
  async resolve(input: ChatContextResolverInput): Promise<ChatResolvedContext | null> {
    if (input.explicitAttachment) {
      return this.normalizeAttachment(input.explicitAttachment, input.monitorId, input.subjectId);
    }

    for (const message of [...input.history].reverse()) {
      if (message.role !== 'student') continue;

      const attachment = message.contextAttachment ?? legacyQuestionAttachment(message);
      if (!attachment) continue;
      const resolved = this.normalizeAttachment(attachment, input.monitorId, input.subjectId);
      if (resolved) return resolved;
    }

    return null;
  }

  private normalizeAttachment(
    attachment: ChatContextAttachment | { type: 'QUESTION'; id: string; attemptId?: string | null; monitorId?: string; subjectId?: string },
    monitorId: string,
    subjectId: string,
  ): ChatResolvedContext | null {
    if (attachment.monitorId && attachment.monitorId !== monitorId) return null;
    if (attachment.subjectId && attachment.subjectId !== subjectId) return null;

    return attachment.type === 'QUESTION'
      ? {
          type: 'QUESTION',
          id: attachment.id,
          attemptId: attachment.attemptId ?? null,
          monitorId,
          subjectId,
        }
      : {
          type: 'FLASHCARD',
          id: attachment.id,
          monitorId,
          subjectId,
        };
  }
}

function legacyQuestionAttachment(message: ChatHistoryMessage) {
  const context = message.questionContext;
  if (!context) return null;
  return {
    type: 'QUESTION' as const,
    id: context.questionId,
    attemptId: context.questionAttemptId ?? null,
    monitorId: context.monitorId,
    subjectId: context.subjectId,
  };
}
