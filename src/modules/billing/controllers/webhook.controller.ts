import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WebhookService } from '../services/webhook.service.js';
import type { BillingWebhook } from '../services/webhook.service.js';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';

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

  async process(request: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply: FastifyReply) {
    const provider = request.params.provider?.toUpperCase();
    if (provider !== 'SIMULATED' && provider !== 'STRIPE') throw new AppError({ code: 'INVALID_PROVIDER', statusCode: 422, publicMessage: 'Provedor de webhook inválido.' });
    if (provider === 'STRIPE') throw new AppError({ code: 'STRIPE_WEBHOOK_NOT_CONFIGURED', statusCode: 503, publicMessage: 'Webhook Stripe ainda não está configurado.' });
    try {
      const parsed = webhookSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Payload de webhook inválido.', internalDetails: parsed.error.flatten() });
      const event = { ...parsed.data, payload: sanitizePayload(parsed.data.payload) } as BillingWebhook;
      return reply.send({ data: await this.service.process(provider, event) });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'WEBHOOK_PROCESSING_FAILED';
      const status = ['WEBHOOK_EVENT_ID_REQUIRED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'PURCHASE_NOT_FOUND', 'PURCHASE_ALREADY_CANCELLED', 'SUBSCRIPTION_ID_REQUIRED'].includes(code) ? 422 : 500;
      if (error instanceof AppError) throw error;
      throw new AppError({ code: status === 500 ? 'WEBHOOK_PROCESSING_FAILED' : code, statusCode: status, publicMessage: status === 500 ? 'Não foi possível processar o webhook.' : 'Payload de webhook rejeitado.', internalDetails: { originalCode: code }, cause: error });
    }
  }
}
