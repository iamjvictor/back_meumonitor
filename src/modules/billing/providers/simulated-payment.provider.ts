import { createHash } from 'node:crypto';
import type { BillingInterval, EffectiveAt, PaymentProvider } from './payment-provider.port.js';

type CheckoutState = {
  checkoutId: string;
  customerId: string;
  purchaseId: string;
  amount: number;
  currency: string;
  interval: BillingInterval;
  expiresAt: Date;
};

type SubscriptionState = {
  subscriptionId: string;
  amount: number;
  interval: BillingInterval;
  effectiveAt: EffectiveAt;
  cancelled: boolean;
  atPeriodEnd: boolean;
};

export class SimulatedPaymentProvider implements PaymentProvider {
  private readonly customers = new Map<string, string>();
  private readonly checkouts = new Map<string, CheckoutState>();
  private readonly subscriptions = new Map<string, SubscriptionState>();

  async getOrCreateCustomer(input: { studentId: string; email: string }) {
    const key = `${input.studentId}:simulated`;
    const existing = this.customers.get(key);
    if (existing) return { customerId: existing };

    const customerId = `sim_customer_${this.digest(key).slice(0, 24)}`;
    this.customers.set(key, customerId);
    return { customerId };
  }

  async createCheckout(input: {
    customerId: string;
    purchaseId: string;
    amount: number;
    currency: string;
    interval: BillingInterval;
  }) {
    const existing = this.checkouts.get(input.purchaseId);
    if (existing) return { checkoutId: existing.checkoutId, checkoutUrl: '/checkout/simulado', expiresAt: existing.expiresAt };

    const checkoutId = `sim_checkout_${this.digest(`${input.customerId}:${input.purchaseId}`).slice(0, 24)}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    this.checkouts.set(input.purchaseId, { ...input, checkoutId, expiresAt });
    return { checkoutId, checkoutUrl: '/checkout/simulado', expiresAt };
  }

  async updateSubscription(input: { subscriptionId: string; amount: number; interval: BillingInterval; effectiveAt: EffectiveAt }) {
    const current = this.subscriptions.get(input.subscriptionId);
    this.subscriptions.set(input.subscriptionId, {
      subscriptionId: input.subscriptionId,
      amount: input.amount,
      interval: input.interval,
      effectiveAt: input.effectiveAt,
      cancelled: current?.cancelled ?? false,
      atPeriodEnd: current?.atPeriodEnd ?? false,
    });
  }

  async cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }) {
    const current = this.subscriptions.get(input.subscriptionId);
    this.subscriptions.set(input.subscriptionId, {
      subscriptionId: input.subscriptionId,
      amount: current?.amount ?? 0,
      interval: current?.interval ?? 'MONTH',
      effectiveAt: input.atPeriodEnd ? 'PERIOD_END' : 'NOW',
      cancelled: true,
      atPeriodEnd: input.atPeriodEnd,
    });
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
