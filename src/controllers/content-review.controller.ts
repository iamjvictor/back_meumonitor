import type { FastifyReply, FastifyRequest } from 'fastify';
import { flashcardReviewSchema, questionReviewSchema } from '../models/content-review.model.js';
import {
  listDocumentsForMonitor,
  listFlashcardsForMonitor,
  listQuestionsForMonitor,
  reviewFlashcard,
  reviewQuestion,
} from '../repositories/content-review.repository.js';

type Params = { monitorId?: string; questionId?: string; flashcardId?: string };

export class ContentReviewController {
  async listQuestions(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      const data = await listQuestionsForMonitor(request.user.id, request.params.monitorId!);
      return reply.send({ data });
    } catch (error) {
      return reply.code(500).send({ error: 'FAILED_TO_LIST_QUESTIONS' });
    }
  }

  async listFlashcards(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      const data = await listFlashcardsForMonitor(request.user.id, request.params.monitorId!);
      return reply.send({ data });
    } catch (error) {
      return reply.code(500).send({ error: 'FAILED_TO_LIST_FLASHCARDS' });
    }
  }

  async listDocuments(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      const data = await listDocumentsForMonitor(request.user.id, request.params.monitorId!);
      return reply.send({ data });
    } catch (error) {
      return reply.code(500).send({ error: 'FAILED_TO_LIST_DOCUMENTS' });
    }
  }

  async question(request: FastifyRequest<{ Params: Params; Body: unknown }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = questionReviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    try {
      const questionId = request.params.questionId;
      if (!questionId) return reply.code(400).send({ error: 'MISSING_QUESTION_ID' });
      const result = await reviewQuestion(request.user.id, request.params.monitorId || null, questionId, parsed.data);
      if (!result) return reply.code(404).send({ error: 'QUESTION_NOT_FOUND' });
      return reply.send({ data: result });
    } catch (error) {
      if (error instanceof Error && [
        'QUESTION_REQUIRES_ANSWER_KEY',
        'QUESTION_REQUIRES_PRIMARY_TOPIC',
        'QUESTION_REQUIRES_FIVE_ALTERNATIVES',
        'QUESTION_REQUIRES_EXPLANATION',
        'QUESTION_TOPIC_NOT_IN_SUBJECT',
      ].includes(error.message)) {
        const messages: Record<string, string> = {
          QUESTION_REQUIRES_ANSWER_KEY: 'A questao precisa de gabarito antes da aprovacao.',
          QUESTION_REQUIRES_PRIMARY_TOPIC: 'A questao precisa de um topico principal antes da aprovacao.',
          QUESTION_REQUIRES_FIVE_ALTERNATIVES: 'A questao precisa de exatamente cinco alternativas A-E antes da aprovacao.',
          QUESTION_REQUIRES_EXPLANATION: 'A questao precisa de explicacao antes da aprovacao.',
          QUESTION_TOPIC_NOT_IN_SUBJECT: 'O topico informado nao pertence a materia da questao.',
        };
        return reply.code(422).send({ error: error.message, message: messages[error.message] });
      }
      throw error;
    }
  }

  async flashcard(request: FastifyRequest<{ Params: Params; Body: unknown }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = flashcardReviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    const flashcardId = request.params.flashcardId;
    if (!flashcardId) return reply.code(400).send({ error: 'MISSING_FLASHCARD_ID' });
    const result = await reviewFlashcard(request.user.id, request.params.monitorId || null, flashcardId, parsed.data);
    if (!result) return reply.code(404).send({ error: 'FLASHCARD_NOT_FOUND' });
    return reply.send({ data: result });
  }
}


