import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';

export async function protectedRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  app.get('/session', async (request) => ({
    data: (() => {
      if (!request.user) throw new Error('Authenticated user was not attached to request');
      return { userId: request.user.id, email: request.user.email };
    })(),
  }));
}
