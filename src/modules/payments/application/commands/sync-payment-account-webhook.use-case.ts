import type { PaymentAccountCredentialStore, PaymentEnvironment } from '../../infrastructure/credentials/payment-account-credential.store.js';

type StoredCredential = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
};

export type PaymentAccountWebhookSyncRepository = {
  findForWebhookSync(accountId: string, environment: string): Promise<{
    id: string;
    environment: string;
    providerWebhookId: string | null;
    credential: StoredCredential | null;
  } | null>;
  setProviderWebhookId(accountId: string, webhookId: string): Promise<void>;
};

export type AccountStatusWebhookProvider = {
  ensureAccountStatusWebhook(credential: string): Promise<{ webhookId: string }>;
};

export class SyncPaymentAccountWebhookUseCase {
  constructor(
    private readonly repository: PaymentAccountWebhookSyncRepository,
    private readonly credentialStore: PaymentAccountCredentialStore,
    private readonly provider: AccountStatusWebhookProvider,
  ) {}

  async execute(accountId: string, environment: string) {
    const account = await this.repository.findForWebhookSync(accountId, environment);
    if (!account) throw new Error('PAYMENT_ACCOUNT_NOT_FOUND_FOR_ENVIRONMENT');
    if (!account.credential) throw new Error('PAYMENT_ACCOUNT_CREDENTIAL_MISSING');

    const credential = this.credentialStore.decrypt(account.id, account.environment as PaymentEnvironment, account.credential);
    const { webhookId } = await this.provider.ensureAccountStatusWebhook(credential);
    await this.repository.setProviderWebhookId(account.id, webhookId);
    return { accountId: account.id, webhookId };
  }
}
