import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WebhookService } from '../services/webhook.service.js';
import type { BillingWebhook } from '../services/webhook.service.js';
import { z } from 'zod';

const webhookSchema = z.object({
  providerEventId: z.string().trim().min(1),
  type: z.string().trim().min(1),
  purchaseId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.literal('BRL'),
  customerId: z.string().trim().min(1).optional(),
  subscriptionId: z.string().trim().min(1).optional(),
  payload: z.unknown().optional(),
}).strict();

const SENSITIVE_KEYS = new Set(['card', 'token', 'secret', 'authorization', 'password', 'cvv', 'cvc']);
function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase())).map(([key, entry]) => [key, sanitizePayload(entry)]));
}

export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  async process(request: FastifyRequest<{ Params: { provider: string }; Body: any }>, reply: FastifyReply) {
    const provider = request.params.provider?.toUpperCase();
    if (provider !== 'SIMULATED' && provider !== 'STRIPE') return reply.code(422).send({ error: 'INVALID_PROVIDER' });
    if (provider === 'STRIPE') return reply.code(503).send({ error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' });
    try {
      const parsed = webhookSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      const event = { ...parsed.data, payload: sanitizePayload(parsed.data.payload) } as BillingWebhook;
      return reply.send({ data: await this.service.process(provider, event) });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'WEBHOOK_PROCESSING_FAILED';
      const status = ['WEBHOOK_EVENT_ID_REQUIRED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'PURCHASE_NOT_FOUND', 'PURCHASE_ALREADY_CANCELLED', 'SUBSCRIPTION_ID_REQUIRED'].includes(code) ? 422 : 500;
      return reply.code(status).send({ error: code });
    }
  }
}
