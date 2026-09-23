import type { PaymentAccountRepository } from '../../infrastructure/persistence/payment-account.repository.js';

export class GetPaymentAccountUseCase {
  constructor(private readonly repository: PaymentAccountRepository) {}

  execute(userId: string) {
    return this.repository.findCurrentByUserId(userId);
  }
}
