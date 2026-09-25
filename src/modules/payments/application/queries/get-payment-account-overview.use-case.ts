import type { AccountOverviewMetrics, AsaasAccountOverviewProviderContract } from '../../infrastructure/providers/asaas/asaas-account-overview.provider.js';
import type { PaymentAccountCredentialStore, EncryptedCredential, PaymentEnvironment } from '../../infrastructure/credentials/payment-account-credential.store.js';

export type PaymentAccountOverview = {
  account: {
    id: string;
    providerAccountId: string;
    walletId: string | null;
    status: string;
    generalStatus: string | null;
    onboardingUrl: string | null;
    dashboardUrl: string | null;
  };
  metrics: AccountOverviewMetrics | null;
};

export class PaymentAccountNotFoundError extends Error {
  constructor() { super('Payment account not found'); this.name = 'PaymentAccountNotFoundError'; }
}

/** Erro explicitamente classificado como falha de contrato/provider. */
export class PaymentAccountOverviewProviderError extends Error {
  constructor(message = 'Payment account provider contract failure') { super(message); this.name = 'PaymentAccountOverviewProviderError'; }
}

export type PaymentAccountRepositoryRow = {
  id: string; providerAccountId?: string | null; walletId?: string | null; status?: string;
  generalStatus?: string | null; onboardingUrl?: string | null; credentialRef?: string | null;
  currentPaymentAccount?: PaymentAccountRepositoryRow | null;
};
type CredentialRepository = {
  findCredentialByUserIdAndAccountId(userId: string, accountId: string): Promise<{
    id: string; accountId: string; environment: string; ciphertext: string; nonce: string; authTag: string; keyVersion: number;
  } | null>;
};
type CredentialResolver = (credentialRef: string, context: { userId: string; accountId: string }) => Promise<string | null>;
export function createPaymentAccountCredentialResolver(repository: CredentialRepository, store: PaymentAccountCredentialStore, environment: 'sandbox' | 'production'): CredentialResolver {
  const expectedEnvironment = environment.toUpperCase() as PaymentEnvironment;
  return async (credentialRef, context) => {
    const credential = await repository.findCredentialByUserIdAndAccountId(context.userId, context.accountId);
    if (!credential || credential.id !== credentialRef || credential.accountId !== context.accountId || credential.environment !== expectedEnvironment) return null;
    try {
      return store.decrypt(context.accountId, expectedEnvironment, {
        ciphertext: credential.ciphertext,
        nonce: credential.nonce,
        authTag: credential.authTag,
        keyVersion: credential.keyVersion,
      } as EncryptedCredential);
    } catch {
      return null;
    }
  };
}
type Repository = { findCurrentByUserId(userId: string): Promise<PaymentAccountRepositoryRow | null> };
type OverviewLogger = (entry: Record<string, unknown>) => void;

export class GetPaymentAccountOverviewUseCase {
  constructor(
    private readonly repository: Repository,
    private readonly provider: AsaasAccountOverviewProviderContract,
    private readonly config: { dashboardUrl: string | null; resolveCredential?: CredentialResolver; logger?: OverviewLogger } = { dashboardUrl: null },
  ) {}

  async execute(userId: string, now = new Date()): Promise<PaymentAccountOverview> {
    const startedAt = Date.now();
    const current = await this.repository.findCurrentByUserId(userId);
    const source = current?.currentPaymentAccount ?? (current && !('currentPaymentAccount' in current) ? current : null);
    if (!source) throw new PaymentAccountNotFoundError();
    const account = {
      id: source.id,
      providerAccountId: source.providerAccountId ?? '',
      walletId: source.walletId ?? null,
      status: source.status ?? 'NOT_STARTED',
      generalStatus: source.generalStatus ?? null,
      onboardingUrl: source.onboardingUrl ?? null,
      dashboardUrl: this.config.dashboardUrl ?? null,
    };
    let metrics: AccountOverviewMetrics | null = null;
    let unavailableReason: string | null = null;
    if (source.status !== 'APPROVED') unavailableReason = 'ACCOUNT_NOT_APPROVED';
    else if (!source.providerAccountId) unavailableReason = 'PROVIDER_ACCOUNT_ID_MISSING';
    else if (!source.credentialRef) unavailableReason = 'CREDENTIAL_REF_MISSING';
    else if (!this.config.resolveCredential) unavailableReason = 'CREDENTIAL_RESOLVER_NOT_CONFIGURED';
    else {
      this.config.logger?.({ event: 'payments.account_overview_credential_resolution_started', userId, accountId: source.id, providerAccountId: source.providerAccountId, walletId: source.walletId ?? null });
      const credential = await this.config.resolveCredential(source.credentialRef, { userId, accountId: source.id });
      this.config.logger?.({ event: 'payments.account_overview_credential_resolution_completed', userId, accountId: source.id, providerAccountId: source.providerAccountId, walletId: source.walletId ?? null, hasCredential: Boolean(credential) });
      if (!credential) unavailableReason = 'CREDENTIAL_NOT_FOUND';
      else {
        const result = await this.provider.getOverview({ providerAccountId: source.providerAccountId, walletId: source.walletId ?? null, credential, now });
        this.config.logger?.({ event: 'payments.account_overview_provider_result', userId, accountId: source.id, providerAccountId: source.providerAccountId, walletId: source.walletId ?? null, kind: result.kind, reason: result.kind === 'unavailable' ? result.reason : null, hasMetrics: result.kind === 'available' });
        if (result.kind === 'available') metrics = result.metrics;
        else unavailableReason = result.reason;
      }
    }
    if (!metrics) this.config.logger?.({ event: 'payments.account_overview_metrics_unavailable', userId, accountId: source.id, providerAccountId: source.providerAccountId ?? null, walletId: source.walletId ?? null, reason: unavailableReason ?? 'METRICS_NOT_RETURNED', durationMs: Date.now() - startedAt });
    return { account, metrics };
  }
}
