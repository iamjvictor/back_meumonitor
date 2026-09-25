import type { AsaasHttpClient } from './asaas-http.client.js';

export class AsaasSubscriptionProvider {
  constructor(private readonly client: AsaasHttpClient) {}

  updateSubscription(input: { subscriptionId: string; amount: number; interval: 'MONTHLY' }) {
    return this.client.request<void>(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      method: 'PUT',
      body: { value: input.amount / 100, cycle: input.interval, updatePendingPayments: false },
    });
  }

  async cancelSubscription(input: { subscriptionId: string }) {
    await this.client.request<void>(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`, { method: 'DELETE' });
  }
}
