import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import type { CheckoutController } from './controllers/checkout.controller.js';

import type { WebhookController } from './controllers/webhook.controller.js';
import type { SubscriptionController } from './controllers/subscription.controller.js';
import type { RouteHandlerMethod } from 'fastify';

export async function billingRoutes(app: FastifyInstance, controller: CheckoutController, webhookController?: WebhookController, subscriptionController?: SubscriptionController) {
  const auth = { onRequest: authMiddleware };
  app.post('/purchases', auth, controller.create.bind(controller));
  app.get('/purchases', auth, controller.purchases.bind(controller));
  app.post('/purchases/:purchaseId/simulated-checkout', auth, controller.checkout.bind(controller));
  app.post('/purchases/:purchaseId/simulated-confirmation', auth, controller.confirm.bind(controller));
  if (webhookController) {
    app.post('/webhooks/SIMULATED', auth, webhookController.process.bind(webhookController) as RouteHandlerMethod);
    app.post('/webhooks/STRIPE', webhookController.process.bind(webhookController) as RouteHandlerMethod);
  }
  app.get('/subscriptions', auth, controller.subscriptions.bind(controller));
  if (subscriptionController) {
    app.post('/subscriptions/:subscriptionId/items', auth, subscriptionController.add.bind(subscriptionController));
    app.delete('/subscriptions/:subscriptionId/items/:monitorId', auth, subscriptionController.remove.bind(subscriptionController));
    app.patch('/subscriptions/:subscriptionId/interval', auth, subscriptionController.interval.bind(subscriptionController));
    app.post('/subscriptions/:subscriptionId/cancel', auth, subscriptionController.cancel.bind(subscriptionController));
  }
}
