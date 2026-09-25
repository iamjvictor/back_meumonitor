import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { EntitlementController } from './entitlement.controller.js';

export async function entitlementRoutes(app: FastifyInstance, controller: EntitlementController) {
  app.get('/student/access', { onRequest: authMiddleware }, controller.get.bind(controller));
}
