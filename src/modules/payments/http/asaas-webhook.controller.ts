import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/errors/app-error.js';
import type { AsaasWebhookIngress } from '../application/commands/accept-webhook.use-case.js';

export class AsaasWebhookController {
  constructor(private readonly ingress: AsaasWebhookIngress) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    try {
      console.log('Webhook Asaas recebido pelo endpoint', {
        event: 'payments.webhook_http_received',
        requestId: request.id,
        hasToken: Boolean(request.headers['asaas-access-token']),
        asaasAccountId: request.headers['x-asaas-account-id'],
      });
      const token = request.headers['asaas-access-token'];
      const accountId = request.headers['x-asaas-account-id'];
      const result = await this.ingress.accept({
        token: Array.isArray(token) ? token[0] : token,
        providerAccountId: Array.isArray(accountId) ? accountId[0] : accountId,
        payload: request.body,
      });
      console.log('Webhook Asaas aceito pelo endpoint', { event: 'payments.webhook_http_accepted', requestId: request.id, ...result });
      return reply.code(200).send(result);
    } catch (error) {
      console.warn('Webhook Asaas rejeitado pelo endpoint', { event: 'payments.webhook_http_rejected', requestId: request.id, errorType: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.message === 'Invalid Asaas webhook token') {
        throw new AppError({ code: 'INVALID_WEBHOOK_TOKEN', statusCode: 401, publicMessage: 'Webhook não autorizado.' });
      }
      if (error instanceof Error && /required/i.test(error.message)) {
        throw new AppError({ code: 'INVALID_WEBHOOK_PAYLOAD', statusCode: 422, publicMessage: 'Payload de webhook inválido.' });
      }
      throw error;
    }
  }
}
