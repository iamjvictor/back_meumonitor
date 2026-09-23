import type { CreateHostedCheckoutInput, CreateHostedCheckoutOutput } from './dto/checkout.dto.js';
import type { PaymentProvider } from '../domain/ports/payment-provider.port.js';

export class PaymentsClient {
  constructor(private readonly provider: PaymentProvider) {}

  createHostedCheckout(input: CreateHostedCheckoutInput): Promise<CreateHostedCheckoutOutput> {
    return this.provider.createHostedCheckout(input);
  }
}
