import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { FlashcardNotFoundError } from './student-flashcards.service.js';
import type { StudentFlashcardsController } from './student-flashcards.controller.js';

const paramsSchema = z.object({ flashcardId: z.string().min(1) });
const randomQuerySchema = z.object({ monitorId: z.string().min(1).optional(), excludeFlashcardId: z.string().min(1).optional() });
const bodySchema = z.object({ rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']) }).strict();

export async function studentFlashcardsRoutes(app: FastifyInstance, controller: StudentFlashcardsController) {
  app.get('/student/flashcards/random', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const query = randomQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' });

    try {
      const card = await controller.getRandomFlashcard({ userId: request.user.id, ...query.data });
      const subjectName = typeof card.subject === 'object' && card.subject && 'name' in card.subject ? String(card.subject.name) : 'Geral';
      const topicName = typeof card.topic === 'object' && card.topic && 'name' in card.topic ? String(card.topic.name) : '';
      return reply.send({ data: {
        id: card.id,
        monitorId: card.monitorId,
        subjectId: card.subjectId,
        topicId: card.topicId,
        subject: topicName ? `${subjectName} • ${topicName}` : subjectName,
        topic: topicName || 'Geral',
        monitorName: typeof card.monitor === 'object' && card.monitor && 'name' in card.monitor ? card.monitor.name : 'Meu Monitor AI',
        question: card.front,
        answer: card.back,
        cardStatus: card.cardStatus,
      } });
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_ACCESSIBLE_MONITORS') return reply.code(404).send({ error: 'NO_ACCESSIBLE_MONITORS', message: 'Você não possui nenhum monitor de estudos comprado ou cadastrado.' });
      if (error instanceof Error && error.message === 'MONITOR_NOT_ACCESSIBLE') return reply.code(403).send({ error: 'MONITOR_NOT_ACCESSIBLE', message: 'Você não possui acesso a este monitor de estudos.' });
      if (error instanceof Error && error.message === 'NO_FLASHCARDS_FOUND') return reply.code(404).send({ error: 'NO_FLASHCARDS_FOUND', message: 'Nenhum flashcard disponível para este monitor no momento.' });
      throw error;
    }
  });

  app.post('/student/flashcards/:flashcardId/review', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'INVALID_RATING',
        message: 'Rating inválido. Escolha entre AGAIN, HARD, GOOD ou EASY.',
      });
    }

    try {
      const data = await controller.reviewFlashcard({
        userId: request.user.id,
        flashcardId: params.data.flashcardId,
        rating: body.data.rating,
      });
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof FlashcardNotFoundError) {
        return reply.code(404).send({ error: 'FLASHCARD_NOT_FOUND', message: 'Flashcard não encontrado.' });
      }
      throw error;
    }
  });
}
