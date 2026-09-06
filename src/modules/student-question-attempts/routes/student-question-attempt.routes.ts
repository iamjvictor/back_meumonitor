import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { StudentQuestionAttemptController } from '../controllers/student-question-attempt.controller.js';

export async function studentQuestionAttemptRoutes(app: FastifyInstance) {
  const controller = new StudentQuestionAttemptController();
  app.get('/questions', { onRequest: authMiddleware }, controller.list.bind(controller));
  app.post('/questions/attempts', { onRequest: authMiddleware }, controller.answer.bind(controller));
}
