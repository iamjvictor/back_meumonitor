import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { StudentPerformanceController } from '../controllers/student-performance.controller.js';

export async function studentPerformanceRoutes(app: FastifyInstance) {
  const controller = new StudentPerformanceController();
  app.get('/performance', { onRequest: authMiddleware }, controller.get.bind(controller));
}
