import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ContentReviewController } from '../controllers/content-review.controller.js';

export async function questionRoutes(app: FastifyInstance) {
  const controller = new ContentReviewController();

  app.put<{ Params: { questionId: string }; Body: unknown }>(
    '/:questionId',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );

  app.patch<{ Params: { questionId: string }; Body: unknown }>(
    '/:questionId',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );

  app.put<{ Params: { questionId: string }; Body: unknown }>(
    '/:questionId/review',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );

  app.patch<{ Params: { questionId: string }; Body: unknown }>(
    '/:questionId/review',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );
}
