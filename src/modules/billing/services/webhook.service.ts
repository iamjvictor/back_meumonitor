export type BillingWebhook = {
  providerEventId: string;
  type: string;
  purchaseId: string;
  amount: number;
  currency: string;
  customerId?: string;
  subscriptionId?: string;
  payload?: unknown;
};

type WebhookRepository = {
  claimEvent(provider: string, event: BillingWebhook): Promise<{ created: boolean; event: { id: string; status: string } }>;
  findPurchaseForWebhook(purchaseId: string): Promise<any>;
  markFailed(id: string, message: string): Promise<unknown>;
  markProcessed(id: string): Promise<unknown>;
  confirmAggregatedPurchase(input: { provider: string; event: BillingWebhook; purchase: any }): Promise<any>;
};

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class WebhookService {
  constructor(private readonly repository: WebhookRepository) {}

  async process(provider: 'SIMULATED' | 'STRIPE', event: BillingWebhook) {
    log('monitor.billing_webhook_received', { provider, providerEventId: event.providerEventId, type: event.type, purchaseId: event.purchaseId });
    log('monitor.billing_webhook_started', { provider, providerEventId: event.providerEventId, type: event.type, purchaseId: event.purchaseId });
    if (!event.providerEventId?.trim()) throw new Error('WEBHOOK_EVENT_ID_REQUIRED');
    const claim = await this.repository.claimEvent(provider, event);
    if (!claim.created && claim.event.status === 'PROCESSED') {
      log('monitor.billing_webhook_idempotent_replay', { provider, providerEventId: event.providerEventId, status: claim.event.status });
      return { status: 'PROCESSED', idempotent: true, eventId: claim.event.id };
    }
    log('monitor.billing_webhook_claimed', { provider, providerEventId: event.providerEventId, eventId: claim.event.id, claimCreated: claim.created, status: claim.event.status });
    log('monitor.billing_webhook_retry_claimed', { provider, providerEventId: event.providerEventId, previousStatus: claim.event.status });
    try {
      const purchase = await this.repository.findPurchaseForWebhook(event.purchaseId);
      if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
      if (['CANCELLED', 'REFUNDED'].includes(purchase.status)) throw new Error('PURCHASE_ALREADY_CANCELLED');
      if (purchase.status === 'PAID') throw new Error('PURCHASE_ALREADY_PAID');
      if (purchase.totalAmount !== event.amount) throw new Error('AMOUNT_MISMATCH');
      if (purchase.currency !== event.currency) throw new Error('CURRENCY_MISMATCH');
      if (provider !== 'SIMULATED' && !event.subscriptionId) throw new Error('SUBSCRIPTION_ID_REQUIRED');
      log('monitor.billing_webhook_validated', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, purchaseStatus: purchase.status, amount: event.amount, currency: event.currency });
      log('monitor.billing_purchase_approval_started', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, previousStatus: purchase.status, itemCount: purchase.items.length });
      const result = await this.repository.confirmAggregatedPurchase({ provider, event, purchase });
      log('monitor.billing_purchase_approved', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, status: 'PAID', amount: event.amount });
      log('monitor.billing_subscription_created', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, subscriptionId: result.subscriptionId, subscriptionCount: result.subscriptionCount });
      log('monitor.billing_subscription_items_created', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, itemCount: result.itemCount });
      log('monitor.billing_enrollments_created', { provider, providerEventId: event.providerEventId, purchaseId: purchase.id, enrollmentCount: result.enrollmentCount });
      await this.repository.markProcessed(claim.event.id);
      log('monitor.billing_webhook_processed', { provider, providerEventId: event.providerEventId, purchaseId: event.purchaseId, status: 'PROCESSED', itemCount: purchase.items.length, enrollmentCount: result.enrollmentCount });
      return { ...result, status: 'PROCESSED', idempotent: false, eventId: claim.event.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WEBHOOK_PROCESSING_FAILED';
      await this.repository.markFailed(claim.event.id, message);
      log('monitor.billing_webhook_failed', { provider, providerEventId: event.providerEventId, purchaseId: event.purchaseId, errorCode: message });
      throw error;
    }
  }
}
