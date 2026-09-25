import { AsaasCheckoutProvider } from './infrastructure/providers/asaas/asaas-checkout.provider.js';
import { AsaasHttpClient } from './infrastructure/providers/asaas/asaas-http.client.js';
import { PaymentsClient } from './application/payments-client.js';
import { CreateCheckoutUseCase } from './application/commands/create-checkout.use-case.js';
import { PaymentCheckoutRepository } from './infrastructure/persistence/payment-checkout.repository.js';
import { PaymentsController } from './http/payments.controller.js';
import { PaymentSubscriptionRepository } from './infrastructure/persistence/payment-subscription.repository.js';
import { AsaasSubscriptionProvider } from './infrastructure/providers/asaas/asaas-subscription.provider.js';
import { PaymentSubscriptionService } from './application/services/payment-subscription.service.js';
import { PaymentSubscriptionController } from './http/payment-subscription.controller.js';
import { TeacherPayoutRepository } from './infrastructure/persistence/teacher-payout.repository.js';
import { TeacherPayoutController } from './http/teacher-payout.controller.js';
import { PaymentAccountRepository } from './infrastructure/persistence/payment-account.repository.js';
import { AsaasAccountOverviewProvider } from './infrastructure/providers/asaas/asaas-account-overview.provider.js';
import { GetPaymentAccountOverviewUseCase } from './application/queries/get-payment-account-overview.use-case.js';
import { LocalPaymentAccountCredentialStore } from './infrastructure/credentials/payment-account-credential.store.js';
import { createPaymentAccountCredentialResolver } from './application/queries/get-payment-account-overview.use-case.js';

export type PaymentsModuleConfig = {
  apiKey: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
  timeoutMs: number;
  dashboardUrl?: string;
  returnBaseUrl: string;
  invalidateAccess?: (studentId: string, reason: string) => Promise<void>;
};

export function createPaymentsModule(config: PaymentsModuleConfig) {
  const httpClient = new AsaasHttpClient(config);
  const checkoutProvider = new AsaasCheckoutProvider(httpClient, config.environment);
  const paymentsClient = new PaymentsClient(checkoutProvider);
  const repository = new PaymentCheckoutRepository();
  const createCheckout = new CreateCheckoutUseCase(repository, checkoutProvider);
  const controller = new PaymentsController(createCheckout, config.returnBaseUrl);
  const subscriptionRepository = new PaymentSubscriptionRepository();
  const subscriptionProvider = new AsaasSubscriptionProvider(httpClient);
  const subscriptionService = new PaymentSubscriptionService(subscriptionRepository, subscriptionProvider, config.invalidateAccess);
  const subscriptionController = new PaymentSubscriptionController(subscriptionRepository, subscriptionService);
  const teacherPayoutRepository = new TeacherPayoutRepository();
  const teacherPayoutController = new TeacherPayoutController(teacherPayoutRepository);
  const credentialStore = new LocalPaymentAccountCredentialStore();
  const paymentAccountRepository = new PaymentAccountRepository(credentialStore);
  const accountOverviewProvider = new AsaasAccountOverviewProvider(httpClient, {
    environment: config.environment,
    logger: (entry) => console.log('Resposta do overview financeiro Asaas', {
      ...entry,
      environment: config.environment,
    }),
  });
  // Sem secret manager/resolver configurado, o use case falha fechado.
  const getPaymentAccountOverview = new GetPaymentAccountOverviewUseCase(paymentAccountRepository, accountOverviewProvider, {
    dashboardUrl: config.dashboardUrl ?? (config.environment === 'sandbox' ? 'https://sandbox.asaas.com/login' : 'https://www.asaas.com/login'),
    resolveCredential: createPaymentAccountCredentialResolver(paymentAccountRepository, credentialStore, config.environment),
    logger: (entry) => console.log('Diagnóstico do overview da conta', {
      ...entry,
      environment: config.environment,
    }),
  });

  return { httpClient, checkoutProvider, paymentsClient, repository, createCheckout, controller, subscriptionRepository, subscriptionProvider, subscriptionService, subscriptionController, teacherPayoutRepository, teacherPayoutController, paymentAccountRepository, accountOverviewProvider, getPaymentAccountOverview };
}
