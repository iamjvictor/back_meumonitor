import type { FastifyInstance } from 'fastify';
import { createBillingModule } from '../modules/billing/billing.module.js';
import { billingRoutes } from '../modules/billing/billing.routes.js';
import { env } from '../config/env.js';
import { getAsaasBaseUrl } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';
export async function studentPurchaseRoutes(app: FastifyInstance) {
  const { controller, webhookController, subscriptionController } = createBillingModule({
    simulationEnabled: env.PAYMENTS_SIMULATION_ENABLED,
    testPriceCents: env.PAYMENTS_TEST_PRICE_CENTS,
    paymentProvider: env.PAYMENTS_PROVIDER,
    asaasApiKey: env.ASAAS_API_KEY,
    asaasBaseUrl: getAsaasBaseUrl(env.ASAAS_ENV),
    asaasTimeoutMs: env.ASAAS_HTTP_TIMEOUT_MS,
  });
  await billingRoutes(app, controller, webhookController, subscriptionController, { includeSubscriptions: false });
}
