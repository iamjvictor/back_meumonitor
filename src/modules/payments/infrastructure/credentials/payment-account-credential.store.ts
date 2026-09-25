import {
  PaymentAccountCredentialCrypto,
  type EncryptedCredential,
  type PaymentEnvironment,
  type CredentialLogger,
} from './payment-account-credential.crypto.js';

export interface PaymentAccountCredentialStore {
  encrypt(accountId: string, environment: PaymentEnvironment, plaintext: string): EncryptedCredential;
  decrypt(accountId: string, environment: PaymentEnvironment, value: EncryptedCredential): string;
}

export class LocalPaymentAccountCredentialStore implements PaymentAccountCredentialStore {
  private readonly crypto: PaymentAccountCredentialCrypto;

  constructor(options: { logger?: CredentialLogger } = {}) {
    this.crypto = new PaymentAccountCredentialCrypto(options);
  }

  encrypt(accountId: string, environment: PaymentEnvironment, plaintext: string): EncryptedCredential {
    return this.crypto.encrypt(accountId, environment, plaintext);
  }

  decrypt(accountId: string, environment: PaymentEnvironment, value: EncryptedCredential): string {
    return this.crypto.decrypt(accountId, environment, value);
  }
}

export { PaymentAccountCredentialCrypto };
export type { EncryptedCredential, PaymentEnvironment, CredentialLogger } from './payment-account-credential.crypto.js';
