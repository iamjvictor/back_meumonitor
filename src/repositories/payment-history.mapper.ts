export type PaymentHistoryStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';

type PaymentOrderHistoryInput = {
  id: string;
  status: string;
  grossCents: number;
  currency: string;
  createdAt: Date;
  items: Array<{ descriptionSnapshot: string }>;
  checkouts: Array<{ providerCheckoutId: string | null }>;
  subscription: {
    charges: Array<{
      id: string;
      status: string;
      grossCents: number;
      providerCheckoutId: string | null;
      confirmedAt: Date | null;
      receivedAt: Date | null;
      createdAt: Date;
    }>;
  } | null;
};

export type PaymentHistoryEntry = {
  id: string;
  status: PaymentHistoryStatus;
  paymentMethod: 'PIX' | 'CREDIT_CARD' | 'BOLETO' | 'OTHER';
  currency: string;
  totalAmount: number | null;
  gatewayCheckoutId: string | null;
  createdAt: Date;
  items: Array<{ descriptionSnapshot: string; quantity: number }>;
  source: 'ASAAS' | 'BILLING';
};

export function mapSubscriptionCancellationHistory(input: {
  id: string;
  monitorId: string | null;
  monitorName: string | null;
  createdAt: Date;
  source: 'ASAAS' | 'BILLING';
}): PaymentHistoryEntry {
  return {
    id: input.id,
    status: 'CANCELLED',
    paymentMethod: 'OTHER',
    currency: 'BRL',
    totalAmount: null,
    gatewayCheckoutId: null,
    createdAt: input.createdAt,
    items: [{ descriptionSnapshot: input.monitorName ?? 'Assinatura', quantity: 1 }],
    source: input.source,
  };
}

export function mapPaymentOrderHistory(order: PaymentOrderHistoryInput): PaymentHistoryEntry[] {
  const items = order.items.map((item) => ({ descriptionSnapshot: item.descriptionSnapshot, quantity: 1 }));
  const latestCheckoutId = order.checkouts[0]?.providerCheckoutId ?? null;

  if (!order.subscription?.charges.length) {
    return [{
      id: order.id,
      status: mapOrderStatus(order.status),
      paymentMethod: 'OTHER',
      currency: order.currency,
      totalAmount: order.grossCents,
      gatewayCheckoutId: latestCheckoutId,
      createdAt: order.createdAt,
      items,
      source: 'ASAAS',
    }];
  }

  return order.subscription.charges.map((charge) => ({
    id: charge.id,
    status: mapChargeStatus(charge.status),
    paymentMethod: 'OTHER' as const,
    currency: order.currency,
    totalAmount: charge.grossCents,
    gatewayCheckoutId: charge.providerCheckoutId ?? latestCheckoutId,
    createdAt: charge.confirmedAt ?? charge.receivedAt ?? charge.createdAt,
    items,
    source: 'ASAAS' as const,
  }));
}

function mapOrderStatus(status: string): PaymentHistoryStatus {
  switch (status) {
    case 'PAYMENT_CONFIRMED': return 'PAID';
    case 'CHECKOUT_CREATION_FAILED': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    case 'EXPIRED': return 'EXPIRED';
    case 'PROCESSING': return 'PROCESSING';
    default: return 'PENDING';
  }
}

function mapChargeStatus(status: string): PaymentHistoryStatus {
  switch (status) {
    case 'CONFIRMED':
    case 'RECEIVED': return 'PAID';
    case 'REFUNDED': return 'REFUNDED';
    case 'CANCELLED': return 'CANCELLED';
    case 'EXPIRED': return 'EXPIRED';
    case 'FAILED': return 'FAILED';
    case 'PROCESSING': return 'PROCESSING';
    default: return 'PENDING';
  }
}
