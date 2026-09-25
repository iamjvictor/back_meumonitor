import { timingSafeEqual } from 'node:crypto';

export type PaymentWebhookInboxInput = {
  providerEventId: string;
  eventType: string;
  payload: unknown;
  providerAccountId?: string;
};

export type PaymentWebhookInbox = {
  accept(input: PaymentWebhookInboxInput): Promise<{ id: string; duplicate: boolean; state: string }>;
};

export class WebhookAuthenticationError extends Error {
  constructor() {
    super('Invalid Asaas webhook token');
  }
}

export type AcceptWebhookInput = {
  token: string | undefined;
  payload: unknown;
  providerAccountId?: string;
};

export class AsaasWebhookIngress {
  constructor(private readonly dependencies: { accessToken: string; inbox: PaymentWebhookInbox; enqueue?: (eventId: string) => Promise<void> }) {}

  async accept(input: AcceptWebhookInput) {
    const payload = asRecord(input.payload);
    const account = asRecord(payload.account);
    const providerAccountId = input.providerAccountId ?? readString(account.id) ?? readString(payload.accountId);
    console.log('Iniciando ingestão do webhook Asaas', {
      event: 'payments.webhook_ingress_started',
      providerAccountId,
      providerOwnerAccountId: readString(account.ownerId),
      eventType: readString(payload.event),
      providerEventId: readString(payload.id),
      hasToken: Boolean(input.token),
    });
    if (!safeTokenEqual(input.token, this.dependencies.accessToken)) {
      throw new WebhookAuthenticationError();
    }

    const eventType = readString(payload.event);
    if (!eventType) throw new Error('Webhook event type is required');

    const payment = asRecord(payload.payment);
    const providerEventId = readString(payload.id) ?? `${eventType}:${readString(payment.id) ?? ''}`;
    if (!providerEventId || providerEventId.endsWith(':')) throw new Error('Provider event id is required');

    const accepted = await this.dependencies.inbox.accept({
      providerEventId,
      eventType,
      payload,
      providerAccountId,
    });

    console.log('Webhook Asaas persistido na inbox', { event: 'payments.webhook_ingress_persisted', eventId: accepted.id, providerEventId, eventType, duplicate: accepted.duplicate, state: accepted.state });

    if (this.dependencies.enqueue && !accepted.duplicate) {
      try {
        console.log('Enfileirando webhook Asaas para processamento', { event: 'payments.webhook_enqueue_started', eventId: accepted.id, providerEventId });
        await this.dependencies.enqueue(accepted.id);
        console.log('Webhook Asaas enfileirado', { event: 'payments.webhook_enqueue_completed', eventId: accepted.id, providerEventId });
      } catch (error) {
        console.warn('Evento de webhook persistido, mas não enfileirado', {
          event: 'payments.webhook_enqueue_failed',
          eventId: accepted.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    return { accepted: true, duplicate: accepted.duplicate, eventId: accepted.id };
  }
}

function safeTokenEqual(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
