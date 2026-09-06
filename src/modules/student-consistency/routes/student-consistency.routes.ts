import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { StudentConsistencyController } from '../controllers/student-consistency.controller.js';

export async function studentConsistencyRoutes(app: FastifyInstance) {
  const controller = new StudentConsistencyController();
  app.get('/consistency', { onRequest: authMiddleware }, controller.get.bind(controller));
}
