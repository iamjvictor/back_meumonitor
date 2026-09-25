export type AccountOverviewMetrics = {
  availableBalanceCents: number;
  receivedThisMonthCents: number;
  pendingReceivablesCents: number;
  pendingTransfersCount: number;
  currency: 'BRL';
  asOf: string;
};

export type AccountOverviewProviderResult =
  | { kind: 'available'; metrics: AccountOverviewMetrics }
  | { kind: 'unavailable'; reason: 'NOT_READY' | 'PROVIDER_UNAVAILABLE' };

type RequestClient = {
  request<T>(path: string, options: { method: 'GET'; credential?: string; environment?: 'sandbox' | 'production' }): Promise<T>;
};

type Logger = (entry: {
  event: string;
  providerAccountId: string;
  walletId?: string | null;
  status: string;
  durationMs?: number;
  resource?: 'balance' | 'received_payments' | 'received_splits' | 'pending_transfers';
  responseShape?: 'object' | 'list' | 'missing' | 'invalid';
  itemCount?: number;
  hasMore?: boolean;
  offset?: number;
  errorType?: string;
}) => void;

export type AsaasAccountOverviewProviderOptions = {
  logger?: Logger;
  environment?: 'sandbox' | 'production';
};

export interface AsaasAccountOverviewProviderContract {
  getOverview(input: { providerAccountId: string; walletId?: string | null; credential: string; now: Date }): Promise<AccountOverviewProviderResult>;
}

type BalanceResponse = { balance?: unknown };
type ListResponse<T> = { data?: unknown };
type Payment = { value?: unknown };
type ReceivedSplit = { totalValue?: unknown };
type Transfer = { status?: unknown };

export class AsaasAccountOverviewProvider implements AsaasAccountOverviewProviderContract {
  constructor(private readonly client: RequestClient, private readonly options: AsaasAccountOverviewProviderOptions = {}) {}

  async getOverview(input: { providerAccountId: string; walletId?: string | null; credential: string; now: Date }): Promise<AccountOverviewProviderResult> {
    const startedAt = Date.now();
    try {
      const [balance, received, receivableSplits, transfers] = await Promise.all([
        this.get<BalanceResponse>('/finance/balance', input.credential, input.providerAccountId, 'balance', undefined, input.walletId),
        this.listAll<Payment>(paymentsPath(input.now, 'RECEIVED'), input.credential, input.providerAccountId, 'received_payments', input.walletId),
        this.listAll<ReceivedSplit>('/payments/splits/received?status=AWAITING_CREDIT', input.credential, input.providerAccountId, 'received_splits', input.walletId),
        this.listPendingTransfers(input.credential, input.providerAccountId, input.walletId),
      ]);
      const availableBalanceCents = balance && typeof balance === 'object' ? toCents(balance.balance) : null;
      const receivedThisMonthCents = sumValues(received);
      const pendingReceivablesCents = sumSplitValues(receivableSplits);
      const pendingTransfersCount = countPendingTransfers(transfers);
      if (availableBalanceCents === null || receivedThisMonthCents === null || pendingReceivablesCents === null || pendingTransfersCount === null) {
        return this.finish(input.providerAccountId, { kind: 'unavailable', reason: 'NOT_READY' }, startedAt);
      }
      return this.finish(input.providerAccountId, { kind: 'available', metrics: {
        availableBalanceCents, receivedThisMonthCents, pendingReceivablesCents, pendingTransfersCount,
        currency: 'BRL', asOf: input.now.toISOString(),
      }}, startedAt);
    } catch (error) {
      const reason = error instanceof Error && error.message === 'Incomplete Asaas list response' ? 'NOT_READY' : 'PROVIDER_UNAVAILABLE';
      return this.finish(input.providerAccountId, { kind: 'unavailable', reason }, startedAt);
    }
  }

  private async get<T>(path: string, credential: string, providerAccountId: string, resource: 'balance' | 'received_payments' | 'received_splits' | 'pending_transfers', page?: { offset: number; list: boolean }, walletId?: string | null): Promise<T> {
    try {
      const response = await this.client.request<T>(path, { method: 'GET', credential, environment: this.options.environment });
      const isList = page?.list === true;
      const rawItems = isList && response && typeof response === 'object' ? (response as ListResponse<unknown>).data : undefined;
      const responseShape = response && typeof response === 'object'
        ? (isList ? (Array.isArray(rawItems) ? 'list' : 'invalid') : 'object')
        : 'missing';
      const itemCount = Array.isArray(rawItems) ? rawItems.length : undefined;
      this.options.logger?.({
        event: 'payments.asaas_account_overview_response_received', providerAccountId, walletId,
        resource, status: responseShape === 'object' || responseShape === 'list' ? 'ok' : 'incomplete', responseShape,
        itemCount,
        hasMore: isList && response && typeof response === 'object' ? Boolean((response as { hasMore?: unknown }).hasMore) : undefined,
        offset: page?.offset,
      });
      return response;
    } catch (error) {
      this.options.logger?.({ event: 'payments.asaas_account_overview_response_received', providerAccountId, walletId, resource, status: 'error', responseShape: 'missing', errorType: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
  }

  private async listAll<T>(basePath: string, credential: string, providerAccountId: string, resource: 'received_payments' | 'received_splits' | 'pending_transfers', walletId?: string | null): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let offset = 0; ; offset += 100) {
      const separator = basePath.includes('?') ? '&' : '?';
      const page = await this.get<ListResponse<T> & { hasMore?: boolean }>(`${basePath}${separator}limit=100&offset=${offset}`, credential, providerAccountId, resource, { offset, list: true }, walletId);
      const data = listData(page);
      if (data === null) throw new Error('Incomplete Asaas list response');
      result.push(...data);
      if (!page.hasMore) return result;
    }
  }

  private async listPendingTransfers(credential: string, providerAccountId: string, walletId?: string | null): Promise<unknown[]> {
    return this.listAll<Transfer>('/transfers', credential, providerAccountId, 'pending_transfers', walletId);
  }

  private finish(providerAccountId: string, result: AccountOverviewProviderResult, startedAt: number) {
    this.options.logger?.({ event: 'payments.account_overview_provider_completed', providerAccountId, status: result.kind, durationMs: Date.now() - startedAt });
    return result;
  }
}

function listData(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ListResponse<unknown>).data)) return null;
  return (value as ListResponse<unknown>).data as unknown[];
}

function paymentsPath(now: Date, status: string) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `/payments?dateCreated[ge]=${year}-${month}-01&dateCreated[le]=${year}-${month}-${day}&status=${status}`;
}

function toCents(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || !Number.isSafeInteger(Math.round(parsed * 100))) return null;
  return Math.round(parsed * 100);
}

function sumValues(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let total = 0;
  for (const item of value) {
    const cents = toCents(item && typeof item === 'object' ? (item as Payment).value : undefined);
    if (cents === null) return null;
    total += cents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function sumSplitValues(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let total = 0;
  for (const item of value) {
    const cents = toCents(item && typeof item === 'object' ? (item as ReceivedSplit).totalValue : undefined);
    if (cents === null) return null;
    total += cents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function countPendingTransfers(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => {
    const status = item && typeof item === 'object' ? (item as Transfer).status : undefined;
    return status === 'PENDING' || status === 'IN_PROGRESS';
  }).length;
}
