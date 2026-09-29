import { env } from '../config/env.js';
import { getAsaasBaseUrl, selectAsaasApiKey } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';
import { AsaasHttpClient } from '../modules/payments/infrastructure/providers/asaas/asaas-http.client.js';

if (env.ASAAS_ENV !== 'production') {
  throw new Error('Este script é somente para ASAAS_ENV=production.');
}

const apiKey = selectAsaasApiKey('production', {
  sandbox: env.ASAAS_API_KEY_SANDBOX,
  production: env.ASAAS_API_KEY,
});
if (!apiKey) throw new Error('Defina ASAAS_API_KEY para consultar o Asaas de produção.');

const { externalReference, checkoutId } = parseArguments(process.argv.slice(2));
const client = new AsaasHttpClient({
  apiKey,
  baseUrl: getAsaasBaseUrl('production'),
  environment: 'production',
  timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS,
});

type AsaasListResponse = { data?: unknown[]; hasMore?: boolean };

const [subscriptions, payments, checkout] = await Promise.all([
  client.request<AsaasListResponse>(`/subscriptions?externalReference=${encodeURIComponent(externalReference)}&includeDeleted=true`, { method: 'GET', environment: 'production' }),
  client.request<AsaasListResponse>(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=100`, { method: 'GET', environment: 'production' }),
  checkoutId
    ? client.request<Record<string, unknown>>(`/checkouts/${encodeURIComponent(checkoutId)}`, { method: 'GET', environment: 'production' })
    : Promise.resolve(null),
]);

console.log(JSON.stringify({
  readOnly: true,
  environment: 'production',
  externalReference,
  checkoutId: checkoutId ?? null,
  subscriptions: summarizeList(subscriptions),
  payments: summarizeList(payments),
  checkout: checkout ? summarizeCheckout(checkout) : null,
}, null, 2));

function parseArguments(args: string[]): { externalReference: string; checkoutId?: string } {
  const externalReference = args.find((arg) => !arg.startsWith('--'))?.trim();
  const checkoutIndex = args.indexOf('--checkout-id');
  const checkoutId = checkoutIndex >= 0 ? args[checkoutIndex + 1]?.trim() : undefined;

  if (!externalReference) {
    throw new Error('Uso: npm run payments:reconcile:asaas -- <externalReference> [--checkout-id <checkoutId>]');
  }
  if (checkoutIndex >= 0 && !checkoutId) throw new Error('Informe um valor para --checkout-id.');
  return { externalReference, checkoutId };
}

function summarizeList(response: AsaasListResponse) {
  return {
    hasMore: response.hasMore ?? false,
    data: (response.data ?? []).map((item) => summarizeProviderResource(item)),
  };
}

function summarizeProviderResource(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value };
  const resource = value as Record<string, unknown>;
  return pick(resource, [
    'id', 'status', 'value', 'netValue', 'billingType', 'subscription', 'checkoutSession',
    'externalReference', 'customer', 'dateCreated', 'dueDate', 'paymentDate', 'clientPaymentDate',
    'nextDueDate', 'cycle', 'deleted', 'deletedDate',
  ]);
}

function summarizeCheckout(value: Record<string, unknown>) {
  return pick(value, ['id', 'status', 'externalReference', 'chargeTypes', 'billingTypes', 'subscription', 'createdAt', 'updatedAt']);
}

function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}
