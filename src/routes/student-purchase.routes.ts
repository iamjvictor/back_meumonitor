import type { FastifyInstance } from 'fastify';
import { createBillingModule } from '../modules/billing/billing.module.js';
import { billingRoutes } from '../modules/billing/billing.routes.js';
import { env } from '../config/env.js';
export async function studentPurchaseRoutes(app: FastifyInstance) {
  const { controller, webhookController, subscriptionController } = createBillingModule({
    simulationEnabled: env.PAYMENTS_SIMULATION_ENABLED,
    testPriceCents: env.PAYMENTS_TEST_PRICE_CENTS,
  });
  await billingRoutes(app, controller, webhookController, subscriptionController);
}
