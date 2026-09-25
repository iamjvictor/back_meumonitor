import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { TeacherController } from '../controllers/teacher.controller.js';
import { TeacherRepository } from '../repositories/teacher.repository.js';
import { TeacherService } from '../services/teacher.service.js';
import { createPublicTeacherProfileCache } from '../cache/public-teacher-profile.cache.js';

export async function teacherRoutes(app: FastifyInstance) {
  const controller = new TeacherController(new TeacherService(new TeacherRepository(), createPublicTeacherProfileCache()));

  app.get('/me', { onRequest: authMiddleware }, controller.getMyProfile.bind(controller));
  app.get('/me/students', { onRequest: authMiddleware }, controller.getMyStudents.bind(controller));
  app.put('/me', { onRequest: authMiddleware }, controller.updateMyProfile.bind(controller));
  app.patch('/me', { onRequest: authMiddleware }, controller.updateMyProfile.bind(controller));
  app.get('/public/:teacherSlug', controller.getPublicProfile.bind(controller));
}
