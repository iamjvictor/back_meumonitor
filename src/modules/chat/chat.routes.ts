import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { aiModels } from '../../config/ai-models.config.js';
import { OpenRouterClient } from '../../worker/client/openrouter.client.js';
import { chatHistoryRedis } from './infrastructure/chat-history.redis.js';
import { RedisChatHistoryRepository } from './repositories/redis-chat-history.repository.js';
import { PrismaChatAccessRepository } from './repositories/prisma-chat-access.repository.js';
import { createChatModule } from './chat.module.js';
import { OpenRouterChatGateway, ChatGenerationError } from './providers/openrouter-chat.gateway.js';
import type { AuthorizedQuestionContext } from './models/chat-generation.model.js';
import { KnowledgeRetrievalChatProvider } from './rag/providers/knowledge-retrieval-chat.provider.js';
import { KnowledgeRetrievalService } from '../../services/knowledge-retrieval.service.js';
import { PrismaQuestionEvidenceProvider } from './rag/providers/prisma-question-evidence.provider.js';
import { PrismaFlashcardEvidenceProvider } from './rag/providers/prisma-flashcard-evidence.provider.js';
import { RedisChatEvidenceRepository } from './rag/repositories/redis-chat-evidence.repository.js';
import type { QuestionEvidenceResult } from './rag/models/question-evidence.model.js';
import type { FlashcardEvidenceResult } from './rag/models/flashcard-evidence.model.js';
import {
  isChatQuestionAttemptAuthorized,
  resolveChatSelectedOption,
} from './services/chat-question-context.service.js';

const chatParams = z.object({
  monitorId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

const questionContextSchema = z.object({
  questionId: z.string().uuid(),
  questionAttemptId: z.string().uuid().nullable().optional(),
  monitorId: z.string().uuid(),
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().nullable().optional(),
  number: z.number().int().positive().nullable().optional(),
  topic: z.string().max(500).nullable().optional(),
  statement: z.string().max(20_000),
  options: z.array(z.object({
    label: z.string().max(20),
    text: z.string().max(5_000),
  })).max(20),
  selectedOption: z.string().max(20).nullable().optional(),
});

const sendMessageBody = z.object({
  message: z.string().trim().min(1).max(4_000),
  topicId: z.string().uuid().nullable().optional(),
  questionContext: questionContextSchema.nullable().optional(),
  contextAttachment: z.object({
    type: z.enum(['QUESTION', 'FLASHCARD']),
    id: z.string().uuid(),
    attemptId: z.string().uuid().nullable().optional(),
    monitorId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
  }).strict().nullable().optional(),
});

const chatHistory = new RedisChatHistoryRepository(chatHistoryRedis);
const chatEvidenceCache = new RedisChatEvidenceRepository(chatHistoryRedis);
const questionEvidenceProvider = new PrismaQuestionEvidenceProvider(prisma);
const flashcardEvidenceProvider = new PrismaFlashcardEvidenceProvider(prisma);
const chatModule = createChatModule({
  access: new PrismaChatAccessRepository(prisma),
  history: chatHistory,
  generation: new OpenRouterChatGateway(
    new OpenRouterClient(),
    undefined,
    {
      model: aiModels.chat,
      maxTokens: aiModels.chatMaxTokens,
      temperature: aiModels.chatTemperature,
      timeoutMs: aiModels.chatTimeoutMs,
    },
  ),
  knowledge: new KnowledgeRetrievalChatProvider(
    new OpenRouterClient(),
    new KnowledgeRetrievalService(),
  ),
  evidenceCache: chatEvidenceCache,
});

export async function chatRoutes(app: FastifyInstance) {
  app.delete('/student/monitors/:monitorId/chat/subjects/:subjectId/messages', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = chatParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ error: 'VALIDATION_ERROR', details: params.error.flatten() });
    }

    try {
      await chatModule.clearMessages({
        userId: request.user.id,
        monitorId: params.data.monitorId,
        subjectId: params.data.subjectId,
      });
      console.log('[chat.routes.ts] [Chat] Histórico encerrado', {
        event: 'chat.history_cleared',
        requestId: request.id,
        userId: request.user.id,
        monitorId: params.data.monitorId,
        subjectId: params.data.subjectId,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_ACCESS_DENIED') {
        return reply.code(403).send({ error: 'CHAT_ACCESS_DENIED' });
      }
      throw error;
    }
  });

  app.get('/student/monitors/:monitorId/chat/subjects/:subjectId/messages', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = chatParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ error: 'VALIDATION_ERROR', details: params.error.flatten() });
    }

    try {
      const messages = await chatModule.listMessages({
        userId: request.user.id,
        monitorId: params.data.monitorId,
        subjectId: params.data.subjectId,
      });
      console.log('[chat.routes.ts] [Chat] Histórico carregado', {
        event: 'chat.history_loaded',
        requestId: request.id,
        userId: request.user.id,
        studentMessageCount: messages.filter((message) => message.role === 'student').length,
        assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
      });
      return reply.code(200).send({ data: { messages } });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_ACCESS_DENIED') {
        return reply.code(403).send({ error: 'CHAT_ACCESS_DENIED' });
      }
      throw error;
    }
  });

  app.post('/student/monitors/:monitorId/chat/subjects/:subjectId/messages', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = chatParams.safeParse(request.params);
    const body = sendMessageBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(422).send({
        error: 'VALIDATION_ERROR',
        details: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten(),
        },
      });
    }

    const requestStartedAt = Date.now();

    console.log('[chat.routes.ts] [Chat] Mensagem recebida na API', {
      event: 'chat.message_received',
      requestId: request.id,
      userId: request.user.id,
      monitorId: params.data.monitorId,
      subjectId: params.data.subjectId,
      messageChars: body.data.message.length,
      questionId: body.data.questionContext?.questionId ?? null,
      questionAttemptId: body.data.questionContext?.questionAttemptId ?? null,
      questionMonitorId: body.data.questionContext?.monitorId ?? null,
      questionSubjectId: body.data.questionContext?.subjectId ?? null,
      questionTopicId: body.data.questionContext?.topicId ?? body.data.topicId ?? null,
    });

    try {
      const scope = await chatModule.authorize({
        userId: request.user.id,
        monitorId: params.data.monitorId,
        subjectId: params.data.subjectId,
      });

      console.log('[chat.routes.ts] [Chat] Acesso autorizado para mensagem', {
        event: 'chat.access_authorized',
        requestId: request.id,
        userId: request.user.id,
        studentId: scope.studentId,
        monitorId: scope.monitorId,
        subjectId: scope.subjectId,
        messageChars: body.data.message.length,
      });

      let authorizedQuestionContext: AuthorizedQuestionContext | null = null;
      let questionEvidence: QuestionEvidenceResult | null = null;
      let flashcardEvidence: FlashcardEvidenceResult | null = null;
      if (body.data.questionContext) {
        const requestedQuestion = body.data.questionContext;
        const question = await prisma.question.findUnique({
          where: { id: requestedQuestion.questionId },
          select: {
            id: true,
            monitorId: true,
            subjectId: true,
            topicId: true,
            text: true,
            alternatives: true,
          },
        });
        let questionAttempt: {
          id: string;
          studentId: string;
          questionId: string;
          monitorId: string;
          selectedAnswer: string;
        } | null = null;
        if (requestedQuestion.questionAttemptId) {
          questionAttempt = await prisma.studentQuestionAttempt.findUnique({
            where: { id: requestedQuestion.questionAttemptId },
            select: {
              id: true,
              studentId: true,
              questionId: true,
              monitorId: true,
              selectedAnswer: true,
            },
          });
        }
        const requestedTopicId = requestedQuestion.topicId ?? body.data.topicId ?? null;
        const questionScopeMatches = Boolean(
          question
          && requestedQuestion.monitorId === scope.monitorId
          && requestedQuestion.subjectId === scope.subjectId
          && question.monitorId === scope.monitorId
          && question.subjectId === scope.subjectId
          && (!requestedTopicId || question.topicId === requestedTopicId),
        );

        console.log('[chat.routes.ts] [Chat] Comparação do contexto da questão', {
          event: 'chat.question_context_scope_compared',
          requestId: request.id,
          userId: request.user.id,
          studentId: scope.studentId,
          requested: {
            questionId: requestedQuestion.questionId,
            monitorIdFromQuestionContext: requestedQuestion.monitorId,
            subjectIdFromQuestionContext: requestedQuestion.subjectId,
            topicIdFromQuestionContext: requestedTopicId,
            monitorId: scope.monitorId,
            subjectId: scope.subjectId,
            topicIdFromBody: body.data.topicId ?? null,
          },
          officialQuestion: question
            ? {
                questionId: question.id,
                monitorId: question.monitorId,
                subjectId: question.subjectId,
                topicId: question.topicId,
              }
            : null,
          matches: questionScopeMatches,
          questionAttempt: questionAttempt
            ? {
                questionAttemptId: questionAttempt.id,
                studentId: questionAttempt.studentId,
                questionId: questionAttempt.questionId,
                monitorId: questionAttempt.monitorId,
                hasSelectedAnswer: Boolean(questionAttempt.selectedAnswer),
              }
            : null,
        });

        if (!question || !questionScopeMatches) {
          return reply.code(403).send({
            error: 'CHAT_QUESTION_CONTEXT_DENIED',
            message: 'A questão não pertence ao monitor, matéria ou tópico autorizado.',
          });
        }

        const questionAttemptMatches = !requestedQuestion.questionAttemptId
          || isChatQuestionAttemptAuthorized({
            attempt: questionAttempt,
            studentId: scope.studentId,
            questionId: question.id,
            monitorId: scope.monitorId,
          });
        if (!questionAttemptMatches) {
          return reply.code(403).send({
            error: 'CHAT_QUESTION_ATTEMPT_DENIED',
            message: 'A tentativa não pertence ao aluno ou à questão autorizada.',
          });
        }

        questionEvidence = await questionEvidenceProvider.get({
          questionId: question.id,
          teacherId: scope.teacherId,
          monitorId: scope.monitorId,
          subjectId: scope.subjectId,
        });
        const primaryQuestionSource = questionEvidence?.citations.find((source) => source.role === 'STATEMENT')
          ?? questionEvidence?.citations[0]
          ?? null;

        console.log('[chat.routes.ts] [Chat] Fontes oficiais da questão carregadas', {
          event: 'chat.question_sources_loaded',
          requestId: request.id,
          questionId: question.id,
          sourceCount: questionEvidence?.metrics.sourceCount ?? 0,
          chunkCount: questionEvidence?.metrics.chunkCount ?? 0,
          answerKeyCount: questionEvidence?.metrics.answerKeyCount ?? 0,
          explanationCount: questionEvidence?.metrics.explanationCount ?? 0,
          evidenceSufficient: questionEvidence?.sufficient ?? false,
          durationMs: questionEvidence?.metrics.durationMs ?? null,
          primaryDocumentId: primaryQuestionSource?.documentId ?? null,
          primaryBlockId: primaryQuestionSource?.blockId ?? null,
        });

        authorizedQuestionContext = {
          questionId: question.id,
          questionAttemptId: requestedQuestion.questionAttemptId ?? null,
          monitorId: question.monitorId,
          subjectId: question.subjectId,
          topicId: question.topicId,
          number: requestedQuestion.number ?? null,
          topic: requestedQuestion.topic ?? null,
          statement: question.text,
          options: normalizeQuestionAlternatives(question.alternatives),
          selectedOption: resolveChatSelectedOption({
            attempt: questionAttempt,
            requestedOption: requestedQuestion.selectedOption,
          }),
          sourceDocumentId: primaryQuestionSource?.documentId ?? null,
          sourceBlockId: primaryQuestionSource?.blockId ?? null,
        };
      }

      if (body.data.contextAttachment?.type === 'FLASHCARD') {
        const attachment = body.data.contextAttachment;
        const attachmentScopeMatches = (!attachment.monitorId || attachment.monitorId === scope.monitorId)
          && (!attachment.subjectId || attachment.subjectId === scope.subjectId);
        if (!attachmentScopeMatches) {
          return reply.code(403).send({
            error: 'CHAT_FLASHCARD_CONTEXT_DENIED',
            message: 'O flashcard não pertence ao monitor ou matéria autorizados.',
          });
        }

        flashcardEvidence = await flashcardEvidenceProvider.get({
          flashcardId: attachment.id,
          teacherId: scope.teacherId,
          monitorId: scope.monitorId,
          subjectId: scope.subjectId,
        });
        console.log('[chat.routes.ts] [Chat] Evidência do flashcard carregada', {
          event: 'chat.flashcard_sources_loaded',
          requestId: request.id,
          flashcardId: attachment.id,
          evidenceFound: Boolean(flashcardEvidence),
          evidenceSufficient: flashcardEvidence?.sufficient ?? false,
          citationCount: flashcardEvidence?.citations.length ?? 0,
        });
        if (!flashcardEvidence) {
          return reply.code(403).send({
            error: 'CHAT_FLASHCARD_CONTEXT_DENIED',
            message: 'O flashcard não está disponível para este contexto.',
          });
        }
      }

      const result = await chatModule.sendAuthorizedMessage(scope, {
        requestId: request.id,
        contextAttachment: body.data.contextAttachment ?? null,
        questionEvidence,
        flashcardEvidence,
        monitorId: params.data.monitorId,
        subjectId: params.data.subjectId,
        message: body.data.message,
        questionContext: authorizedQuestionContext,
      });

      console.log('[chat.routes.ts] [Chat] Resposta gerada e salva no histórico temporário', {
        event: 'chat.generation_completed',
        requestId: request.id,
        studentId: scope.studentId,
        monitorId: scope.monitorId,
        subjectId: scope.subjectId,
        questionId: body.data.questionContext?.questionId ?? null,
        responseChars: result.assistantMessage.content.length,
        rag: result.observability,
        durationMs: Date.now() - requestStartedAt,
      });

      return reply.code(200).send({
        data: {
          message: result.assistantMessage.content,
          messageId: result.assistantMessage.id,
          monitorId: scope.monitorId,
          subjectId: scope.subjectId,
          questionId: body.data.questionContext?.questionId ?? null,
        },
      });
    } catch (error) {
      console.log('[chat.routes.ts] [Chat] Requisição de chat falhou', {
        event: 'chat.request_failed',
        requestId: request.id,
        durationMs: Date.now() - requestStartedAt,
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      if (error instanceof Error && error.message === 'CHAT_ACCESS_DENIED') {
        return reply.code(403).send({
          error: 'CHAT_ACCESS_DENIED',
          message: 'O aluno não possui acesso a este monitor ou matéria.',
        });
      }
      if (error instanceof ChatGenerationError) {
        const statusCode = error.code === 'CHAT_GENERATION_TIMEOUT' ? 504 : 502;
        return reply.code(statusCode).send({
          error: error.code,
          message: 'Não foi possível gerar uma resposta agora. Tente novamente.',
        });
      }
      throw error;
    }
  });
}

function normalizeQuestionAlternatives(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { label?: unknown; text?: unknown };
    return typeof candidate.label === 'string' && typeof candidate.text === 'string'
      ? [{ label: candidate.label, text: candidate.text }]
      : [];
  });
}
