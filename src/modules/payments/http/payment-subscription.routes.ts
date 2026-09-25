import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { PaymentSubscriptionController } from './payment-subscription.controller.js';

export async function paymentSubscriptionRoutes(app: FastifyInstance, controller: PaymentSubscriptionController) {
  app.get('/subscriptions', { onRequest: authMiddleware }, controller.list.bind(controller));
  app.get('/subscriptions/:subscriptionId', { onRequest: authMiddleware }, controller.detail.bind(controller));
  app.get('/subscriptions/history', { onRequest: authMiddleware }, controller.history.bind(controller));
  app.delete('/subscriptions/:subscriptionId/items/:monitorId', { onRequest: authMiddleware }, controller.remove.bind(controller));
}
