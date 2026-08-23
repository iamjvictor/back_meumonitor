import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ProfileImageController } from '../controllers/profile-image.controller.js';
import { ProfileImageRepository } from '../repositories/profile-image.repository.js';
import { ProfileImageService } from '../services/profile-image.service.js';

export async function profileImageRoutes(app: FastifyInstance) {
  const controller = new ProfileImageController(new ProfileImageService(new ProfileImageRepository()));
  app.post('/me/avatar', { onRequest: authMiddleware, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, controller.upload.bind(controller));
}
