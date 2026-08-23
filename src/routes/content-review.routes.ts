import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ContentReviewController } from '../controllers/content-review.controller.js';

export async function contentReviewRoutes(app: FastifyInstance) {
  const controller = new ContentReviewController();

  app.get<{ Params: { monitorId: string } }>(
    '/:monitorId/questions',
    { onRequest: authMiddleware },
    controller.listQuestions.bind(controller),
  );
  app.get<{ Params: { monitorId: string } }>(
    '/:monitorId/flashcards',
    { onRequest: authMiddleware },
    controller.listFlashcards.bind(controller),
  );
  app.get<{ Params: { monitorId: string } }>(
    '/:monitorId/documents',
    { onRequest: authMiddleware },
    controller.listDocuments.bind(controller),
  );

  // Rotas de atualização de questões (com e sem sufixo /review)
  app.put<{ Params: { monitorId: string; questionId: string }; Body: unknown }>(
    '/:monitorId/questions/:questionId/review',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );
  app.put<{ Params: { monitorId: string; questionId: string }; Body: unknown }>(
    '/:monitorId/questions/:questionId',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );
  app.patch<{ Params: { monitorId: string; questionId: string }; Body: unknown }>(
    '/:monitorId/questions/:questionId/review',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );
  app.patch<{ Params: { monitorId: string; questionId: string }; Body: unknown }>(
    '/:monitorId/questions/:questionId',
    { onRequest: authMiddleware },
    controller.question.bind(controller),
  );

  // Rotas de atualização de flashcards (com e sem sufixo /review)
  app.put<{ Params: { monitorId: string; flashcardId: string }; Body: unknown }>(
    '/:monitorId/flashcards/:flashcardId/review',
    { onRequest: authMiddleware },
    controller.flashcard.bind(controller),
  );
  app.put<{ Params: { monitorId: string; flashcardId: string }; Body: unknown }>(
    '/:monitorId/flashcards/:flashcardId',
    { onRequest: authMiddleware },
    controller.flashcard.bind(controller),
  );
  app.patch<{ Params: { monitorId: string; flashcardId: string }; Body: unknown }>(
    '/:monitorId/flashcards/:flashcardId/review',
    { onRequest: authMiddleware },
    controller.flashcard.bind(controller),
  );
  app.patch<{ Params: { monitorId: string; flashcardId: string }; Body: unknown }>(
    '/:monitorId/flashcards/:flashcardId',
    { onRequest: authMiddleware },
    controller.flashcard.bind(controller),
  );
}


