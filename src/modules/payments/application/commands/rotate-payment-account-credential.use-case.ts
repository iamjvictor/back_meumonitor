import { randomUUID } from 'node:crypto';
import type { PaymentAccountCredentialStore, PaymentEnvironment } from '../../infrastructure/credentials/payment-account-credential.store.js';

type Repository = {
  findAccountByUserAndEnvironment(userId: string, environment: string): Promise<{ id: string; environment: string } | null>;
  replaceCredential(accountId: string, environment: string, encrypted: { ciphertext: string; nonce: string; authTag: string; keyVersion: number }, credentialId: string): Promise<{ id: string }>;
  revokeCredential(accountId: string, environment: string): Promise<void>;
};

export class PaymentAccountCredentialNotFoundError extends Error { constructor() { super('Payment account not found'); this.name = 'PaymentAccountCredentialNotFoundError'; } }
export class PaymentAccountEnvironmentMismatchError extends Error { constructor() { super('Payment account environment mismatch'); this.name = 'PaymentAccountEnvironmentMismatchError'; } }

export class RotatePaymentAccountCredentialUseCase {
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(private readonly repository: Repository, private readonly store: PaymentAccountCredentialStore) {}

  execute(input: { userId: string; environment: string; operationKey: string; credential: string }) {
    const environment = normalizeEnvironment(input.environment);
    const key = `rotate:${input.userId}:${environment}:${input.operationKey}`;
    const existing = this.operations.get(key);
    if (existing) return existing;
    const operation = this.rotate(input.userId, environment, input.credential);
    this.operations.set(key, operation);
    return operation;
  }

  revoke(input: { userId: string; environment: string; operationKey: string }) {
    const environment = normalizeEnvironment(input.environment);
    const key = `revoke:${input.userId}:${environment}:${input.operationKey}`;
    const existing = this.operations.get(key);
    if (existing) return existing as Promise<{ accountId: string; environment: PaymentEnvironment; revoked: boolean }>;
    const operation = this.doRevoke(input.userId, environment);
    this.operations.set(key, operation);
    return operation;
  }

  private async rotate(userId: string, environment: PaymentEnvironment, plaintext: string) {
    if (!plaintext) throw new Error('PAYMENT_ACCOUNT_CREDENTIAL_REQUIRED');
    const account = await this.repository.findAccountByUserAndEnvironment(userId, environment);
    if (!account) throw new PaymentAccountCredentialNotFoundError();
    if (account.environment !== environment) throw new PaymentAccountEnvironmentMismatchError();
    const encrypted = this.store.encrypt(account.id, environment, plaintext);
    const credentialId = randomUUID();
    const saved = await this.repository.replaceCredential(account.id, environment, encrypted, credentialId);
    return { accountId: account.id, environment, credentialId: saved.id };
  }

  private async doRevoke(userId: string, environment: PaymentEnvironment) {
    const account = await this.repository.findAccountByUserAndEnvironment(userId, environment);
    if (!account) throw new PaymentAccountCredentialNotFoundError();
    if (account.environment !== environment) throw new PaymentAccountEnvironmentMismatchError();
    await this.repository.revokeCredential(account.id, environment);
    return { accountId: account.id, environment, revoked: true as const };
  }
}

function normalizeEnvironment(value: string): PaymentEnvironment {
  const normalized = value.toUpperCase();
  if (normalized === 'SANDBOX' || normalized === 'PRODUCTION') return normalized;
  throw new PaymentAccountEnvironmentMismatchError();
}
