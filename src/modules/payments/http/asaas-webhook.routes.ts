import type { FastifyInstance } from 'fastify';
import type { AsaasWebhookController } from './asaas-webhook.controller.js';

export async function asaasWebhookRoutes(app: FastifyInstance, controller: AsaasWebhookController) {
  app.post('/payments/webhooks/asaas', controller.handle.bind(controller));
}
