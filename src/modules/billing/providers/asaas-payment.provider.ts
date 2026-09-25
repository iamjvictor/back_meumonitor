import type { BillingInterval, EffectiveAt, PaymentProvider } from './payment-provider.port.js';

type AsaasRequestClient = {
  request<T>(path: string, request: { method: 'DELETE' | 'PUT'; body?: unknown }): Promise<T>;
};

/**
 * Usa o Asaas para encerrar recorrências e mantém o provider legado para as
 * operações de checkout ainda não migradas para o contexto de billing.
 */
export class AsaasPaymentProvider implements PaymentProvider {
  constructor(
    private readonly client: AsaasRequestClient,
    private readonly fallback: PaymentProvider,
  ) {}

  getOrCreateCustomer(input: { studentId: string; email: string }) {
    return this.fallback.getOrCreateCustomer(input);
  }

  createCheckout(input: {
    customerId: string;
    purchaseId: string;
    amount: number;
    currency: string;
    interval: BillingInterval;
  }) {
    return this.fallback.createCheckout(input);
  }

  updateSubscription(input: {
    subscriptionId: string;
    amount: number;
    interval: BillingInterval;
    effectiveAt: EffectiveAt;
  }) {
    return this.client.request<void>(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      method: 'PUT',
      body: {
        value: input.amount / 100,
        cycle: input.interval === 'YEAR' ? 'YEARLY' : 'MONTHLY',
        updatePendingPayments: false,
      },
    });
  }

  async cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }) {
    await this.client.request<void>(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`, { method: 'DELETE' });
  }
}
