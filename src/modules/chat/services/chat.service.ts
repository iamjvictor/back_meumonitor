import { randomUUID } from 'node:crypto';
import type { ChatGenerationPort } from '../ports/chat-generation.port.js';
import type { ChatHistoryMessage, ChatHistoryScope } from '../models/chat-history.model.js';
import type { ChatContextAttachment } from '../models/chat.model.js';
import type { AuthorizedQuestionContext } from '../models/chat-generation.model.js';
import type { ChatHistoryPort } from '../ports/chat-history.port.js';
import type { ChatScope } from '../ports/chat-access.port.js';
import { ChatRagService } from '../rag/services/chat-rag.service.js';
import { ChatContextResolver } from '../rag/services/chat-context-resolver.service.js';
import type { QuestionEvidenceResult } from '../rag/models/question-evidence.model.js';
import type { FlashcardEvidenceResult } from '../rag/models/flashcard-evidence.model.js';

const MAX_HISTORY_MESSAGES = 40;

export type SendChatMessageInput = ChatScope & {
  requestId?: string;
  message: string;
  questionContext: AuthorizedQuestionContext | null;
  contextAttachment?: ChatContextAttachment | null;
  questionEvidence?: QuestionEvidenceResult | null;
  flashcardEvidence?: FlashcardEvidenceResult | null;
  historyLimit?: number;
};

export type SendChatMessageResult = {
  studentMessage: ChatHistoryMessage;
  assistantMessage: ChatHistoryMessage;
  observability: {
    historyCount: number;
    ragUsed: boolean;
    citationCount: number;
    candidateCount: number;
    selectedCount: number;
    retrievalDurationMs: number;
    retrievalScoreAverage: number | null;
    retrievalSignal: 'strong' | 'moderate' | 'weak' | 'none';
    contextChars: number;
  };
};

export class ChatService {
  constructor(
    private readonly history: ChatHistoryPort,
    private readonly generation: ChatGenerationPort,
    private readonly rag: ChatRagService,
    private readonly contextResolver = new ChatContextResolver(),
  ) {}

  async listMessages(scope: ChatScope) {
    const historyScope: ChatHistoryScope = {
      studentId: scope.studentId,
      monitorId: scope.monitorId,
      subjectId: scope.subjectId,
    };
    return this.history.list(historyScope);
  }

  async clearMessages(scope: ChatScope) {
    const historyScope: ChatHistoryScope = {
      studentId: scope.studentId,
      monitorId: scope.monitorId,
      subjectId: scope.subjectId,
    };
    await this.history.clear(historyScope);
  }

  async sendMessage(input: SendChatMessageInput): Promise<SendChatMessageResult> {
    const content = input.message.trim();
    if (!content) throw new Error('CHAT_MESSAGE_REQUIRED');

    const scope: ChatHistoryScope = {
      studentId: input.studentId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
    };
    const previousHistory = await this.history.list(scope);
    const history = previousHistory.slice(-normalizeHistoryLimit(input.historyLimit));
    const resolvedContext = await this.contextResolver.resolve({
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      explicitAttachment: input.contextAttachment ?? questionAttachment(input.questionContext),
      history,
    });
    console.log('[chat.service.ts] [Chat] Contexto de anexo resolvido', {
      event: 'chat.context_attachment_resolved',
      requestId: input.requestId ?? null,
      contextType: resolvedContext?.type ?? null,
      contextId: resolvedContext?.id ?? null,
      inherited: !input.contextAttachment && !input.questionContext && Boolean(resolvedContext),
    });
    const rag = await this.rag.enrich({
      message: content,
      requestId: input.requestId,
      history,
      questionContext: input.questionContext,
      studentId: input.studentId,
      teacherId: input.teacherId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      topicId: input.questionContext?.topicId ?? null,
      questionDocumentId: input.questionContext?.sourceDocumentId ?? null,
      questionBlockId: input.questionContext?.sourceBlockId ?? null,
      questionId: resolvedContext?.type === 'QUESTION' ? resolvedContext.id : null,
      flashcardId: resolvedContext?.type === 'FLASHCARD' ? resolvedContext.id : null,
      questionEvidence: input.questionEvidence ?? null,
      flashcardEvidence: input.flashcardEvidence ?? null,
    });
    const studentMessage: ChatHistoryMessage = {
      id: randomUUID(),
      role: 'student',
      content,
      createdAt: new Date().toISOString(),
      questionContext: input.questionContext
        ? {
            questionId: input.questionContext.questionId,
            questionAttemptId: input.questionContext.questionAttemptId ?? null,
            monitorId: input.questionContext.monitorId,
            subjectId: input.questionContext.subjectId,
            topicId: input.questionContext.topicId ?? null,
            number: input.questionContext.number ?? null,
          }
        : null,
      contextAttachment: resolvedContext,
    };

    await this.history.append(scope, studentMessage);
    const generated = await this.generation.generate({
      message: content,
      history,
      questionContext: input.questionContext,
      ragContext: rag.context,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
    });
    const assistantMessage: ChatHistoryMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: generated.content,
      createdAt: new Date().toISOString(),
    };
    await this.history.append(scope, assistantMessage);

    const scoreAverage = rag.result.metrics.scoreAverage ?? null;
    const retrievalSignal = getRetrievalSignal({
      used: rag.result.used,
      selectedCount: rag.result.metrics.selectedCount,
      scoreAverage,
    });

    console.log('[chat.service.ts] [Chat] Sinal de qualidade da recuperação', {
      event: 'chat.rag_quality_signal',
      requestId: input.requestId ?? null,
      historyCount: history.length,
      ragUsed: rag.result.used,
      citationCount: rag.result.citations.length,
      candidateCount: rag.result.metrics.candidateCount,
      selectedCount: rag.result.metrics.selectedCount,
      scoreAverage,
      retrievalSignal,
      contextChars: rag.context.length,
      responseChars: assistantMessage.content.length,
    });

    return {
      studentMessage,
      assistantMessage,
      observability: {
        historyCount: history.length,
        ragUsed: rag.result.used,
        citationCount: rag.result.citations.length,
        candidateCount: rag.result.metrics.candidateCount,
        selectedCount: rag.result.metrics.selectedCount,
        retrievalDurationMs: rag.result.metrics.durationMs,
        retrievalScoreAverage: scoreAverage,
        retrievalSignal,
        contextChars: rag.context.length,
      },
    };
  }
}

function questionAttachment(questionContext: AuthorizedQuestionContext | null): ChatContextAttachment | null {
  if (!questionContext) return null;
  return {
    type: 'QUESTION',
    id: questionContext.questionId,
    attemptId: questionContext.questionAttemptId ?? null,
    monitorId: questionContext.monitorId,
    subjectId: questionContext.subjectId,
  };
}

function getRetrievalSignal(input: {
  used: boolean;
  selectedCount: number;
  scoreAverage: number | null;
}): 'strong' | 'moderate' | 'weak' | 'none' {
  if (!input.used || input.selectedCount === 0) return 'none';
  if (input.scoreAverage !== null && input.scoreAverage >= 0.65) return 'strong';
  if (input.scoreAverage !== null && input.scoreAverage >= 0.4) return 'moderate';
  return 'weak';
}

function normalizeHistoryLimit(value?: number) {
  if (!Number.isFinite(value)) return MAX_HISTORY_MESSAGES;
  return Math.min(Math.max(Math.floor(value as number), 1), MAX_HISTORY_MESSAGES);
}
