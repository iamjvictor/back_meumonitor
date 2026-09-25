import type { AsaasAccountProvider, CreateSubaccountCommand } from '../../infrastructure/providers/asaas/asaas-account.provider.js';
import type { PaymentAccountRepository } from '../../infrastructure/persistence/payment-account.repository.js';

export class PaymentAccountAlreadyExistsError extends Error {}

export class StartPaymentAccountUseCase {
  constructor(private readonly repository: PaymentAccountRepository, private readonly provider: AsaasAccountProvider) {}

  async execute(userId: string, input: CreateSubaccountCommand) {
    const startedAt = Date.now();
    console.log('Início do caso de uso de conta de recebimento', {
      event: 'payments.account_use_case_started',
      userId,
      provider: 'ASAAS',
      environment: process.env.ASAAS_ENV?.toUpperCase() ?? 'SANDBOX',
    });
    const current = await this.repository.findCurrentByUserId(userId);
    if (!current) {
      console.warn('Perfil de professor não encontrado para conta de recebimento', { event: 'payments.account_teacher_not_found', userId });
      throw new Error('TEACHER_PROFILE_NOT_FOUND');
    }
    if (current.currentPaymentAccount) {
      console.warn('Professor já possui conta de recebimento atual', {
        event: 'payments.account_already_exists',
        userId,
        accountId: current.currentPaymentAccount.id,
        status: current.currentPaymentAccount.status,
      });
      throw new PaymentAccountAlreadyExistsError();
    }

    console.log('Enviando solicitação de subconta ao Asaas', { event: 'payments.asaas_subaccount_create_started', userId });
    const created = await this.provider.createSubaccount(input);
    console.log('Subconta criada pelo Asaas', {
      event: 'payments.asaas_subaccount_create_completed',
      userId,
      providerAccountId: created.providerAccountId,
      walletId: created.walletId,
      status: created.status,
      hasOnboardingUrl: Boolean(created.onboardingUrl),
      apiKeyReceived: Boolean(created.apiKey),
      durationMs: Date.now() - startedAt,
    });
    console.log('Persistindo vínculo local da subconta', { event: 'payments.account_persistence_started', userId, providerAccountId: created.providerAccountId });
    try {
      const account = await this.repository.persistCreatedAccount(userId, input, created);
      console.log('Vínculo local da subconta persistido', {
        event: 'payments.account_persistence_completed',
        userId,
        accountId: account.id,
        providerAccountId: account.providerAccountId,
        durationMs: Date.now() - startedAt,
      });
      return account;
    } catch (error) {
      console.warn('Persistência local da subconta falhou', {
        event: 'payments.account_persistence_failed',
        userId,
        providerAccountId: created.providerAccountId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}
