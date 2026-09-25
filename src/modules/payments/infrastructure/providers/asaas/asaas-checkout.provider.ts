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
  link?: string | null;
  url?: string | null;
  expiresAt?: string | null;
};

export class AsaasCheckoutProvider implements PaymentProvider {
  constructor(
    private readonly client: AsaasRequestClient,
    private readonly environment: 'sandbox' | 'production' = 'production',
  ) {}

  async createHostedCheckout(command: HostedCheckoutCommand): Promise<HostedCheckoutResult> {
    if (!Number.isInteger(command.amountCents) || command.amountCents <= 0) {
      throw new Error('amountCents must be a positive integer');
    }

    const splits = command.splits.map((split) => ({
      walletId: split.walletId,
      percentageValue: Number(split.percentage),
    }));
    console.log('Preparando checkout recorrente Asaas', {
      event: 'payments.asaas_checkout_request_prepared',
      externalReference: command.externalReference,
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      cycle: 'MONTHLY',
      nextDueDate: command.nextDueDate,
      splitCount: splits.length,
      splits: splits.map((split) => ({ walletId: `${split.walletId.slice(0, 8)}...`, percentageValue: split.percentageValue })),
    });

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
        subscription: { cycle: 'MONTHLY', nextDueDate: command.nextDueDate },
        callback: {
          successUrl: command.successUrl,
          cancelUrl: command.cancelUrl,
          expiredUrl: command.expiredUrl,
          autoRedirect: true,
        },
        splits,
      },
    });

    const checkoutUrl = response.link ?? response.url ?? buildCheckoutUrl(this.environment, response.id);
    console.log('Resposta de checkout Asaas normalizada', {
      event: 'payments.asaas_checkout_response_normalized',
      providerCheckoutId: response.id,
      hasLink: Boolean(response.link),
      hasUrl: Boolean(response.url),
      checkoutUrlOrigin: response.link ? 'link' : response.url ? 'url' : 'constructed',
    });

    return {
      providerCheckoutId: response.id,
      checkoutUrl,
      expiresAt: response.expiresAt ? new Date(response.expiresAt) : null,
    };
  }
}

function buildCheckoutUrl(environment: 'sandbox' | 'production', checkoutId: string) {
  const origin = environment === 'sandbox' ? 'https://sandbox.asaas.com' : 'https://asaas.com';
  return `${origin}/checkoutSession/show/${encodeURIComponent(checkoutId)}`;
}
