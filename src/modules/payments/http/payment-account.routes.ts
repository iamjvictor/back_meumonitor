import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { PaymentAccountController } from './payment-account.controller.js';

export async function paymentAccountRoutes(app: FastifyInstance, controller: PaymentAccountController) {
  app.get('/teachers/me/payment-account', { onRequest: authMiddleware }, controller.get.bind(controller));
  app.post('/teachers/me/payment-account', { onRequest: authMiddleware }, controller.start.bind(controller));
  app.get('/teachers/me/payment-account/status', { onRequest: authMiddleware }, controller.get.bind(controller));
}
