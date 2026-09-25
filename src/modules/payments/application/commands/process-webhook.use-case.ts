import type { PrismaPaymentWebhookRepository } from '../../infrastructure/persistence/prisma-webhook.repository.js';
import type { PaymentAccountRepository } from '../../infrastructure/persistence/payment-account.repository.js';
import type { PaymentEventRepository } from '../../infrastructure/persistence/payment-event.repository.js';

const WAITING_CORRELATION_EVENTS = new Set([
  'CHECKOUT_CREATED',
  'CHECKOUT_PAID',
  'CHECKOUT_CANCELED',
  'CHECKOUT_EXPIRED',
  'PAYMENT_CREATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_SPLIT_DONE',
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_DELETED',
]);

export class ProcessPaymentWebhookUseCase {
  constructor(private readonly repository: PrismaPaymentWebhookRepository, private readonly accounts?: PaymentAccountRepository, private readonly payments?: PaymentEventRepository) {}

  async execute(eventId: string) {
    console.log('Processamento de webhook Asaas iniciado', { event: 'payments.webhook_processing_started', eventId });
    const event = await this.repository.claim(eventId);
    if (!event) {
      console.log('Processamento de webhook Asaas ignorado', { event: 'payments.webhook_processing_skipped', eventId, reason: 'CLAIM_FAILED_OR_ALREADY_PROCESSED' });
      return { skipped: true };
    }

    try {
      if (event.eventType.startsWith('ACCOUNT_STATUS_')) {
        const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
        const account = payload.account && typeof payload.account === 'object' ? payload.account as Record<string, unknown> : {};
        const providerAccountId = event.providerAccountId || (typeof account.id === 'string' ? account.id : typeof payload.accountId === 'string' ? payload.accountId : undefined);
        console.log('Evento de status de conta identificado', { event: 'payments.account_status_event_identified', eventId: event.id, eventType: event.eventType, providerAccountId, hasAccountPayload: Boolean(payload.account), hasAccountStatusPayload: Boolean(payload.accountStatus) });
        if (providerAccountId && this.accounts) {
          const result = await this.accounts.applyAccountStatusEvent(providerAccountId, event.eventType, event.createdAt);
          console.log('Atualização de conta pelo webhook concluída', { event: 'payments.account_status_update_completed', eventId: event.id, providerAccountId, eventType: event.eventType, updatedRows: result?.count ?? 0 });
          if ((result?.count ?? 0) === 0) {
            await this.repository.markWaitingCorrelation(event.id);
            console.log('Webhook de status aguardando vínculo da conta local', { event: 'payments.webhook_processing_waiting_correlation', eventId: event.id, providerAccountId });
            return { skipped: false, state: 'WAITING_CORRELATION' };
          }
        }
        await this.repository.markProcessed(event.id, 'ACCOUNT_STATUS_APPLIED');
        console.log('Webhook de status marcado como processado', { event: 'payments.webhook_processing_completed', eventId: event.id, state: 'ACCOUNT_STATUS_APPLIED' });
        return { skipped: false, state: 'ACCOUNT_STATUS_APPLIED' };
      }
      if (event.eventType === 'PAYMENT_CONFIRMED' || event.eventType === 'PAYMENT_RECEIVED' || event.eventType === 'PAYMENT_SPLIT_DONE') {
        console.log('Evento financeiro Asaas identificado', { event: 'payments.payment_event_identified', eventId: event.id, eventType: event.eventType, hasPaymentPayload: Boolean((event.payload as Record<string, unknown>)?.payment) });
        if (!this.payments) {
          await this.repository.markWaitingCorrelation(event.id);
          return { skipped: false, state: 'WAITING_CORRELATION' };
        }
        const result = await this.payments.applyPaymentEvent({ environment: event.environment, eventId: event.id, eventType: event.eventType, payload: event.payload, occurredAt: event.createdAt });
        if (result.updatedRows === 0) {
          await this.repository.markWaitingCorrelation(event.id);
          console.log('Evento financeiro aguardando correlação', { event: 'payments.payment_event_waiting_correlation', eventId: event.id, eventType: event.eventType });
          return { skipped: false, state: 'WAITING_CORRELATION' };
        }
        await this.repository.markProcessed(event.id, 'PAYMENT_ACCESS_APPLIED');
        console.log('Evento financeiro processado e acesso confirmado', { event: 'payments.payment_event_processing_completed', eventId: event.id, eventType: event.eventType, chargeId: result.chargeId, studentId: result.studentId, monitorId: result.monitorId, state: 'PAYMENT_ACCESS_APPLIED' });
        return { skipped: false, state: 'PAYMENT_ACCESS_APPLIED' };
      }
      if (event.eventType === 'SUBSCRIPTION_DELETED' || event.eventType === 'SUBSCRIPTION_UPDATED' || event.eventType === 'PAYMENT_OVERDUE' || event.eventType === 'PAYMENT_REFUNDED' || event.eventType === 'PAYMENT_PARTIALLY_REFUNDED' || event.eventType === 'PAYMENT_CHARGEBACK_REQUESTED') {
        if (!this.payments?.applySubscriptionEvent) {
          await this.repository.markWaitingCorrelation(event.id);
          return { skipped: false, state: 'WAITING_CORRELATION' };
        }
        const result = await this.payments.applySubscriptionEvent({ environment: event.environment, eventId: event.id, eventType: event.eventType, payload: event.payload, occurredAt: event.createdAt });
        if (result.updatedRows === 0) {
          await this.repository.markWaitingCorrelation(event.id);
          return { skipped: false, state: 'WAITING_CORRELATION' };
        }
        await this.repository.markProcessed(event.id, 'SUBSCRIPTION_STATE_APPLIED');
        return { skipped: false, state: 'SUBSCRIPTION_STATE_APPLIED' };
      }
      if (WAITING_CORRELATION_EVENTS.has(event.eventType)) {
        await this.repository.markWaitingCorrelation(event.id);
        return { skipped: false, state: 'WAITING_CORRELATION' };
      }
      await this.repository.markIgnored(event.id);
      return { skipped: false, state: 'IGNORED' };
    } catch (error) {
      await this.repository.markFailed(event.id, error instanceof Error ? error.message : 'PAYMENT_WEBHOOK_PROCESSING_FAILED');
      throw error;
    }
  }
}
