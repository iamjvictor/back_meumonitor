import { CheckoutController } from './controllers/checkout.controller.js';
import { PurchaseRepository } from './repositories/purchase.repository.js';
import { CheckoutService } from './services/checkout.service.js';
import { CustomerRepository } from './repositories/customer.repository.js';
import { SimulatedPaymentProvider } from './providers/simulated-payment.provider.js';
import { WebhookEventRepository } from './repositories/webhook-event.repository.js';
import { WebhookService } from './services/webhook.service.js';
import { WebhookController } from './controllers/webhook.controller.js';
import { SubscriptionRepository } from './repositories/subscription.repository.js';
import { SubscriptionService } from './services/subscription.service.js';
import { SubscriptionController } from './controllers/subscription.controller.js';
import { SimulatedConfirmationService } from './services/simulated-confirmation.service.js';

export type BillingModuleConfig = {
  simulationEnabled: boolean;
  testPriceCents: number;
};

/**
 * Composition root do bounded context de billing.
 * As rotas dependem apenas deste módulo; Stripe e persistência podem ser
 * substituídos aqui quando o contexto virar um serviço independente.
 */
export function createBillingModule(config: BillingModuleConfig) {
  const repository = new PurchaseRepository();
  const customerRepository = new CustomerRepository();
  const provider = new SimulatedPaymentProvider();
  const webhookRepository = new WebhookEventRepository();
  const webhookService = new WebhookService({
    claimEvent: webhookRepository.claimEvent.bind(webhookRepository),
    findPurchaseForWebhook: repository.findPurchaseForWebhook.bind(repository),
    markFailed: webhookRepository.markFailed.bind(webhookRepository),
    markProcessed: webhookRepository.markProcessed.bind(webhookRepository),
    confirmAggregatedPurchase: repository.confirmAggregatedPurchase.bind(repository),
  });
  const webhookController = new WebhookController(webhookService);
  const simulatedConfirmation = new SimulatedConfirmationService(repository, webhookService);
  const service = new CheckoutService(repository, customerRepository, provider, config, simulatedConfirmation);
  const controller = new CheckoutController(service as any);
  const subscriptionRepository = new SubscriptionRepository();
  const subscriptionService = new SubscriptionService(subscriptionRepository, provider, config);
  const subscriptionController = new SubscriptionController(subscriptionService, subscriptionRepository);

  return { repository, customerRepository, provider, service, controller, webhookService, webhookController, subscriptionRepository, subscriptionService, subscriptionController };
}
