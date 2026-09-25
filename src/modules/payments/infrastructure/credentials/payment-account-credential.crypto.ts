import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type PaymentEnvironment = 'SANDBOX' | 'PRODUCTION';

export type EncryptedCredential = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
};

export type CredentialLogger = (entry: { event: string; accountId: string; environment: PaymentEnvironment; keyVersion: number }) => void;

export class PaymentAccountCredentialCrypto {
  private readonly key: Buffer;
  private readonly keyVersion = 1;
  private readonly logger?: CredentialLogger;

  constructor(options: { logger?: CredentialLogger } = {}) {
    const encoded = process.env.ASAAS_CREDENTIAL_ENCRYPTION_KEY;
    if (!encoded) throw new Error('Payment account credential master key is missing');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Payment account credential master key must be 32 bytes');
    this.key = key;
    this.logger = options.logger;
  }

  encrypt(accountId: string, environment: PaymentEnvironment, plaintext: string): EncryptedCredential {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.aad(accountId, environment));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const result = { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), keyVersion: this.keyVersion };
    this.logger?.({ event: 'payment_account_credential.encrypted', accountId, environment, keyVersion: this.keyVersion });
    return result;
  }

  decrypt(accountId: string, environment: PaymentEnvironment, value: EncryptedCredential): string {
    if (value.keyVersion !== this.keyVersion) throw new Error(`Unsupported credential key version: ${value.keyVersion}`);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.nonce, 'base64'));
    decipher.setAAD(this.aad(accountId, environment));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    this.logger?.({ event: 'payment_account_credential.decrypted', accountId, environment, keyVersion: this.keyVersion });
    return plaintext;
  }

  private aad(accountId: string, environment: PaymentEnvironment): Buffer {
    return Buffer.from(`payment-account-credential:${accountId}:${environment}`, 'utf8');
  }
}
