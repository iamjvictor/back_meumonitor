import { randomUUID } from 'node:crypto';
import type { PaymentAccountCredentialStore, PaymentEnvironment } from '../../infrastructure/credentials/payment-account-credential.store.js';

type Repository = {
  findAccountByUserAndEnvironment(userId: string, environment: string): Promise<{ id: string; environment: string } | null>;
  replaceCredential(accountId: string, environment: string, encrypted: { ciphertext: string; nonce: string; authTag: string; keyVersion: number }, credentialId: string): Promise<{ id: string }>;
  revokeCredential(accountId: string, environment: string): Promise<void>;
  findCredentialOperation(userId: string, environment: string, operation: string, operationKey: string): Promise<{ result: unknown } | null>;
  rotateCredentialWithOperation(...args: any[]): Promise<unknown>;
  revokeCredentialWithOperation(...args: any[]): Promise<unknown>;
};

export class PaymentAccountCredentialNotFoundError extends Error { constructor() { super('Payment account not found'); this.name = 'PaymentAccountCredentialNotFoundError'; } }
export class PaymentAccountEnvironmentMismatchError extends Error { constructor() { super('Payment account environment mismatch'); this.name = 'PaymentAccountEnvironmentMismatchError'; } }

export class RotatePaymentAccountCredentialUseCase {
  constructor(private readonly repository: Repository, private readonly store: PaymentAccountCredentialStore) {}

  execute(input: { userId: string; environment: string; operationKey: string; credential: string }) {
    const environment = normalizeEnvironment(input.environment);
    return this.rotate(input.userId, environment, input.operationKey, input.credential);
  }

  revoke(input: { userId: string; environment: string; operationKey: string }) {
    const environment = normalizeEnvironment(input.environment);
    return this.doRevoke(input.userId, environment, input.operationKey);
  }

  private async rotate(userId: string, environment: PaymentEnvironment, operationKey: string, plaintext: string) {
    const prior = await this.repository.findCredentialOperation(userId, environment, 'ROTATE', operationKey); if (prior) return prior.result as any;
    if (!plaintext) throw new Error('PAYMENT_ACCOUNT_CREDENTIAL_REQUIRED');
    const account = await this.repository.findAccountByUserAndEnvironment(userId, environment);
    if (!account) throw new PaymentAccountCredentialNotFoundError();
    if (account.environment !== environment) throw new PaymentAccountEnvironmentMismatchError();
    const encrypted = this.store.encrypt(account.id, environment, plaintext);
    const credentialId = randomUUID();
    const result = { accountId: account.id, environment, credentialId }; try { return await this.repository.rotateCredentialWithOperation(userId, environment, operationKey, encrypted, credentialId, result) as typeof result; } catch (error: any) { if (error?.code !== 'P2002') throw error; const prior = await this.repository.findCredentialOperation(userId, environment, 'ROTATE', operationKey); if (prior) return prior.result as typeof result; throw error; }
  }

  private async doRevoke(userId: string, environment: PaymentEnvironment, operationKey: string) {
    const prior = await this.repository.findCredentialOperation(userId, environment, 'REVOKE', operationKey); if (prior) return prior.result as any;
    const account = await this.repository.findAccountByUserAndEnvironment(userId, environment);
    if (!account) throw new PaymentAccountCredentialNotFoundError();
    if (account.environment !== environment) throw new PaymentAccountEnvironmentMismatchError();
    const result = { accountId: account.id, environment, revoked: true as const }; try { return await this.repository.revokeCredentialWithOperation(userId, environment, operationKey, result) as typeof result; } catch (error: any) { if (error?.code !== 'P2002') throw error; const prior = await this.repository.findCredentialOperation(userId, environment, 'REVOKE', operationKey); if (prior) return prior.result as typeof result; throw error; }
  }
}

function normalizeEnvironment(value: string): PaymentEnvironment {
  const normalized = value.toUpperCase();
  if (normalized === 'SANDBOX' || normalized === 'PRODUCTION') return normalized;
  throw new PaymentAccountEnvironmentMismatchError();
}
