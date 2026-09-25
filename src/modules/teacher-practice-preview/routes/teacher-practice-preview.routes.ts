import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { PrismaTeacherPracticePreviewRepository } from '../repositories/teacher-practice-preview.repository.js';
import { TeacherPracticePreviewService } from '../services/teacher-practice-preview.service.js';
import { TeacherPracticePreviewController } from '../controllers/teacher-practice-preview.controller.js';

export async function teacherPracticePreviewRoutes(app: FastifyInstance) {
  const repository = new PrismaTeacherPracticePreviewRepository();
  const controller = new TeacherPracticePreviewController(new TeacherPracticePreviewService(repository));

  app.get('/questions', { onRequest: authMiddleware }, controller.list.bind(controller));
  app.post('/attempts', { onRequest: authMiddleware }, controller.answer.bind(controller));
  app.get('/flashcards/random', { onRequest: authMiddleware }, controller.randomFlashcard.bind(controller));
  app.post('/flashcards/:flashcardId/review', { onRequest: authMiddleware }, controller.reviewFlashcard.bind(controller));
}
