import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { getAsaasBaseUrl, selectAsaasApiKey } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';
import { ProcessPaymentWebhookUseCase } from '../modules/payments/application/commands/process-webhook.use-case.js';
import { PaymentEventRepository } from '../modules/payments/infrastructure/persistence/payment-event.repository.js';
import { PrismaPaymentWebhookRepository } from '../modules/payments/infrastructure/persistence/prisma-webhook.repository.js';
import { AsaasHttpClient } from '../modules/payments/infrastructure/providers/asaas/asaas-http.client.js';

if (env.ASAAS_ENV !== 'production') throw new Error('Este script é somente para ASAAS_ENV=production.');

const paymentId = process.argv[2]?.trim();
const subscriptionId = process.argv[3]?.trim();
const checkoutSession = process.argv[4]?.trim();
if (!paymentId || !subscriptionId || !checkoutSession) {
  throw new Error('Uso: npm run payments:reconcile:asaas-payment -- <paymentId> <subscriptionId> <checkoutSession>');
}

const apiKey = selectAsaasApiKey('production', { sandbox: env.ASAAS_API_KEY_SANDBOX, production: env.ASAAS_API_KEY });
if (!apiKey) throw new Error('Defina ASAAS_API_KEY para reconciliar o pagamento de produção.');

const client = new AsaasHttpClient({ apiKey, baseUrl: getAsaasBaseUrl('production'), environment: 'production', timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS });
const payment = await client.request<Record<string, unknown>>(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET', environment: 'production' });
const subscription = await client.request<Record<string, unknown>>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET', environment: 'production' });

const paymentStatus = readString(payment.status)?.toUpperCase();
const subscriptionStatus = readString(subscription.status)?.toUpperCase();
if (!['CONFIRMED', 'RECEIVED'].includes(paymentStatus ?? '')) throw new Error(`Pagamento ${paymentId} não está confirmado: ${paymentStatus ?? 'sem status'}.`);
if (subscriptionStatus !== 'ACTIVE') throw new Error(`Assinatura ${subscriptionId} não está ativa: ${subscriptionStatus ?? 'sem status'}.`);
if (readString(payment.subscription) !== subscriptionId) throw new Error(`O pagamento ${paymentId} não pertence à assinatura ${subscriptionId}.`);
if (readString(payment.checkoutSession) !== checkoutSession) throw new Error(`O pagamento ${paymentId} não pertence ao checkout ${checkoutSession}.`);

const localOrder = await prisma.paymentOrder.findFirst({
  where: { environment: 'PRODUCTION', checkouts: { some: { providerCheckoutId: checkoutSession } } },
  select: { id: true, status: true, studentId: true, subscription: { select: { id: true, status: true, providerSubscriptionId: true } } },
});
if (!localOrder) throw new Error(`Nenhum pedido local foi encontrado para checkoutSession=${checkoutSession}.`);
if (!localOrder.subscription) throw new Error(`O pedido local ${localOrder.id} não possui assinatura.`);
if (localOrder.subscription.providerSubscriptionId && localOrder.subscription.providerSubscriptionId !== subscriptionId) {
  throw new Error(`A assinatura local ${localOrder.subscription.id} já está vinculada a outro providerSubscriptionId.`);
}

const eventType = paymentStatus === 'RECEIVED' ? 'PAYMENT_RECEIVED' : 'PAYMENT_CONFIRMED';
const providerEventId = `manual-reconciliation:${paymentId}`;
const inbox = new PrismaPaymentWebhookRepository('PRODUCTION');
const accepted = await inbox.accept({ providerEventId, eventType, payload: { id: providerEventId, event: eventType, dateCreated: payment.dateCreated, payment }, });
if (!accepted.duplicate) {
  const processor = new ProcessPaymentWebhookUseCase(inbox, undefined, new PaymentEventRepository());
  const result = await processor.execute(accepted.id);
  console.log(JSON.stringify({ readOnlyProviderCheck: false, reconciled: true, eventType, eventId: accepted.id, result, localOrderId: localOrder.id, paymentId, subscriptionId, checkoutSession }, null, 2));
} else {
  console.log(JSON.stringify({ readOnlyProviderCheck: false, reconciled: false, reason: 'EVENT_ALREADY_ACCEPTED', eventId: accepted.id, localOrderId: localOrder.id, paymentId, subscriptionId, checkoutSession }, null, 2));
}

await prisma.$disconnect();

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
