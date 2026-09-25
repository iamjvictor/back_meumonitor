export type PaymentSplit = {
  walletId: string;
  percentage: string;
};

export type HostedCheckoutCommand = {
  externalReference: string;
  customerId?: string;
  monitorName: string;
  description: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  nextDueDate: string;
  splits: PaymentSplit[];
};

export type HostedCheckoutResult = {
  providerCheckoutId: string;
  checkoutUrl: string;
  expiresAt: Date | null;
};

export type PaymentProvider = {
  createHostedCheckout(command: HostedCheckoutCommand): Promise<HostedCheckoutResult>;
};
