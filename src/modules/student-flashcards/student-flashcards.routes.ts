import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { FlashcardNotFoundError } from './student-flashcards.service.js';
import type { StudentFlashcardsController } from './student-flashcards.controller.js';

const paramsSchema = z.object({ flashcardId: z.string().min(1) });
const bodySchema = z.object({ rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']) }).strict();

export async function studentFlashcardsRoutes(app: FastifyInstance, controller: StudentFlashcardsController) {
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
