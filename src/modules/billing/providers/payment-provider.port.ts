export type BillingInterval = 'MONTH' | 'YEAR';
export type EffectiveAt = 'NOW' | 'PERIOD_END';

export type PaymentProvider = {
  getOrCreateCustomer(input: { studentId: string; email: string }): Promise<{ customerId: string }>;
  createCheckout(input: {
    customerId: string;
    purchaseId: string;
    amount: number;
    currency: string;
    interval: BillingInterval;
  }): Promise<{ checkoutId: string; checkoutUrl: string; expiresAt: Date }>;
  updateSubscription(input: {
    subscriptionId: string;
    amount: number;
    interval: BillingInterval;
    effectiveAt: EffectiveAt;
  }): Promise<void>;
  cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
};
