import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { StudentExperienceController } from '../controllers/student-experience.controller.js';

export async function studentExperienceRoutes(app: FastifyInstance) {
  const controller = new StudentExperienceController();
  app.get<{ Querystring: { monitorId?: string; month?: string } }>(
    '/experience',
    { onRequest: authMiddleware },
    controller.get.bind(controller)
  );
}
