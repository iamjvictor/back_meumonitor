import type {
  HostedCheckoutCommand,
  HostedCheckoutResult,
  PaymentProvider,
} from '../../../domain/ports/payment-provider.port.js';

type AsaasRequestClient = {
  request<T>(path: string, request: { method: 'POST'; body: unknown }): Promise<T>;
};

type AsaasCheckoutResponse = {
  id: string;
  url: string;
  expiresAt?: string | null;
};

export class AsaasCheckoutProvider implements PaymentProvider {
  constructor(private readonly client: AsaasRequestClient) {}

  async createHostedCheckout(command: HostedCheckoutCommand): Promise<HostedCheckoutResult> {
    if (!Number.isInteger(command.amountCents) || command.amountCents <= 0) {
      throw new Error('amountCents must be a positive integer');
    }

    const response = await this.client.request<AsaasCheckoutResponse>('/checkouts', {
      method: 'POST',
      body: {
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        externalReference: command.externalReference,
        ...(command.customerId ? { customer: command.customerId } : {}),
        items: [{
          name: command.monitorName,
          description: command.description,
          quantity: 1,
          value: command.amountCents / 100,
        }],
        subscription: { cycle: 'MONTHLY' },
        callback: {
          successUrl: command.successUrl,
          cancelUrl: command.cancelUrl,
          expiredUrl: command.expiredUrl,
        },
        splits: command.splits.map((split) => ({
          walletId: split.walletId,
          percentage: Number(split.percentage),
        })),
      },
    });

    return {
      providerCheckoutId: response.id,
      checkoutUrl: response.url,
      expiresAt: response.expiresAt ? new Date(response.expiresAt) : null,
    };
  }
}
