type AsaasAccountRequestClient = {
  request<T>(path: string, request: { method: 'POST'; body: unknown }): Promise<T>;
};

export type AsaasAccountProviderOptions = {
  webhookUrl?: string;
  webhookEmail?: string;
  webhookAuthToken?: string;
};

const ACCOUNT_STATUS_WEBHOOK_EVENTS = [
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
  'ACCOUNT_STATUS_DOCUMENT_APPROVED',
  'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_DOCUMENT_PENDING',
  'ACCOUNT_STATUS_DOCUMENT_REJECTED',
] as const;

export type CreateSubaccountCommand = {
  name: string;
  email: string;
  cpfCnpj: string;
  birthDate?: string;
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  postalCode: string;
  site?: string;
};

type AsaasSubaccountResponse = {
  id: string;
  walletId: string;
  apiKey?: string;
  status?: string;
  onboardingUrl?: string | null;
  webhooks?: Array<{ id?: string }>;
};

export type CreatedSubaccount = {
  providerAccountId: string;
  walletId: string;
  status: string;
  onboardingUrl: string | null;
  webhookId: string | null;
  /** Internal one-shot credential; never serialize or log this value. */
  readonly apiKey?: string;
};

export class AsaasAccountProvider {
  constructor(private readonly client: AsaasAccountRequestClient, private readonly options: AsaasAccountProviderOptions = {}) {}

  async createSubaccount(command: CreateSubaccountCommand): Promise<CreatedSubaccount> {
    const webhook = this.buildAccountStatusWebhook();
    const payload = compact({ ...command, webhooks: webhook ? [webhook] : undefined });
    if (!webhook) {
      console.warn('Webhook de status não será provisionado na subconta', {
        event: 'payments.asaas_subaccount_webhook_configuration_missing',
        hasWebhookUrl: Boolean(this.options.webhookUrl),
        hasWebhookEmail: Boolean(this.options.webhookEmail),
        hasWebhookAuthToken: Boolean(this.options.webhookAuthToken),
      });
    }
    console.log('Preparando criação de subconta no Asaas', {
      event: 'payments.asaas_subaccount_request_prepared',
      path: '/accounts',
      fieldsSent: Object.keys(payload),
      companyType: command.companyType ?? null,
      payload: maskAsaasPayload(payload),
    });
    const response = await this.client.request<AsaasSubaccountResponse>('/accounts', {
      method: 'POST',
      body: payload,
    });

    const created = {
      providerAccountId: response.id,
      walletId: response.walletId,
      status: normalizeAccountStatus(response.status),
      onboardingUrl: response.onboardingUrl ?? null,
      webhookId: response.webhooks?.[0]?.id ?? null,
    };
    if (response.apiKey) {
      // Keep the transient credential available to the application layer without
      // making it part of normal object serialization/public responses.
      Object.defineProperty(created, 'apiKey', { value: response.apiKey, enumerable: false, writable: false, configurable: false });
    }
    console.log('Resposta de subconta normalizada', {
      event: 'payments.asaas_subaccount_response_normalized',
      providerAccountId: created.providerAccountId,
      walletId: created.walletId,
      status: created.status,
      hasOnboardingUrl: Boolean(created.onboardingUrl),
      webhookId: created.webhookId,
    });
    return created;
  }

  private buildAccountStatusWebhook() {
    if (!this.options.webhookUrl || !this.options.webhookEmail || !this.options.webhookAuthToken) return null;
    return {
      name: 'MeuMonitor AI - Status da Conta',
      url: this.options.webhookUrl,
      email: this.options.webhookEmail,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: this.options.webhookAuthToken,
      sendType: 'SEQUENTIALLY',
      events: ACCOUNT_STATUS_WEBHOOK_EVENTS,
    };
  }
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''));
}

function normalizeAccountStatus(value: string | undefined) {
  return value?.trim().toUpperCase() || 'PENDING';
}

function maskAsaasPayload(payload: Record<string, unknown>) {
  const mask = (value: unknown, visible = 2) => {
    const text = String(value ?? '');
    if (text.length <= visible) return '*'.repeat(text.length);
    return `${text.slice(0, visible)}${'*'.repeat(Math.max(4, text.length - visible - 2))}${text.slice(-2)}`;
  };

  const maskedWebhooks = Array.isArray(payload.webhooks)
    ? payload.webhooks.map((webhook) => {
        if (!webhook || typeof webhook !== 'object') return webhook;
        const { authToken, ...safeWebhook } = webhook as Record<string, unknown>;
        return { ...safeWebhook, authToken: authToken ? '[REDACTED]' : undefined };
      })
    : payload.webhooks;

  return {
    ...payload,
    webhooks: maskedWebhooks,
    cpfCnpj: payload.cpfCnpj ? mask(payload.cpfCnpj, 3) : undefined,
    email: payload.email ? mask(payload.email, 2) : undefined,
    mobilePhone: payload.mobilePhone ? mask(payload.mobilePhone, 2) : undefined,
    address: payload.address ? '[REDACTED]' : undefined,
    addressNumber: payload.addressNumber ? '[REDACTED]' : undefined,
    province: payload.province ? '[REDACTED]' : undefined,
    postalCode: payload.postalCode ? mask(payload.postalCode, 2) : undefined,
    incomeValue: payload.incomeValue !== undefined ? '[REDACTED]' : undefined,
  };
}
