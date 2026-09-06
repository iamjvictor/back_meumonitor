import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const idSchema = z.string().uuid();
const addSchema = z.object({ monitorId: idSchema }).strict();
const intervalSchema = z.object({ interval: z.enum(['MONTH', 'YEAR']) }).strict();
const paramsSchema = z.object({ subscriptionId: idSchema }).strict();
const itemParamsSchema = paramsSchema.extend({ monitorId: idSchema }).strict();

function log(event: string, data: Record<string, unknown>) { console.log(event, { event, ...data }); }

export class SubscriptionController {
  constructor(private readonly service: any, private readonly repository: any) {}

  private fail(reply: FastifyReply, error: unknown, context: Record<string, unknown>) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const statuses: Record<string, number> = {
      STUDENT_NOT_FOUND: 404, SUBSCRIPTION_NOT_FOUND: 404, SUBSCRIPTION_ITEM_NOT_FOUND: 404,
      MONITOR_NOT_PUBLISHED: 422, ACTIVE_ENROLLMENT: 409, INVALID_BILLING_INTERVAL: 422,
      IDEMPOTENCY_KEY_REQUIRED: 422, IDEMPOTENCY_KEY_REUSED: 409, IDEMPOTENCY_REPLAY_UNAVAILABLE: 409,
      PROVIDER_ERROR: 502, ACTIVE_SUBSCRIPTION_EXISTS: 409,
    };
    const status = statuses[code] ?? 500;
    log('monitor.billing_subscription_http_failed', { ...context, errorCode: code, statusCode: status });
    return reply.code(status).send({ error: status === 500 ? 'INTERNAL_SERVER_ERROR' : code, message: status === 500 ? 'Erro interno do servidor.' : 'Não foi possível processar a assinatura.' });
  }

  private user(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) { reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessão de usuário obrigatória.' }); return null; }
    return request.user.id;
  }

  private key(request: FastifyRequest, reply: FastifyReply) {
    const value = request.headers['idempotency-key'];
    if (typeof value !== 'string' || value.trim().length < 8 || value.length > 255) { reply.code(422).send({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key válido é obrigatório.' }); return null; }
    return value.trim();
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.user(request, reply); if (!userId) return;
    log('monitor.billing_subscription_http_list_started', { requestId: request.id, userId });
    try { const data = await this.repository.findSubscriptionsForUser(userId); log('monitor.billing_subscription_http_list_completed', { requestId: request.id, userId, count: data.length }); return reply.send({ data }); }
    catch (error) { return this.fail(reply, error, { requestId: request.id, route: 'list', userId }); }
  }

  async add(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.user(request, reply); if (!userId) return; const key = this.key(request, reply); if (!key) return;
    const parsed = addSchema.safeParse(request.body); const params = paramsSchema.safeParse(request.params);
    if (!parsed.success || !params.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Dados inválidos.' });
    try { const data = await this.service.addMonitor(userId, params.data.subscriptionId, parsed.data.monitorId, key); return reply.send({ data }); }
    catch (error) { return this.fail(reply, error, { requestId: request.id, route: 'add', userId }); }
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.user(request, reply); if (!userId) return; const key = this.key(request, reply); if (!key) return;
    const params = itemParamsSchema.safeParse(request.params); if (!params.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Dados inválidos.' });
    try { const data = await this.service.removeMonitor(userId, params.data.subscriptionId, params.data.monitorId, key); return reply.send({ data }); }
    catch (error) { return this.fail(reply, error, { requestId: request.id, route: 'remove', userId }); }
  }

  async interval(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.user(request, reply); if (!userId) return; const key = this.key(request, reply); if (!key) return;
    const params = paramsSchema.safeParse(request.params); const body = intervalSchema.safeParse(request.body); if (!params.success || !body.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Dados inválidos.' });
    try { const data = await this.service.changeInterval(userId, params.data.subscriptionId, body.data.interval, key); return reply.send({ data }); }
    catch (error) { return this.fail(reply, error, { requestId: request.id, route: 'interval', userId }); }
  }

  async cancel(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.user(request, reply); if (!userId) return; const key = this.key(request, reply); if (!key) return;
    const params = paramsSchema.safeParse(request.params); if (!params.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Dados inválidos.' });
    try { const data = await this.service.cancel(userId, params.data.subscriptionId, key); return reply.send({ data }); }
    catch (error) { return this.fail(reply, error, { requestId: request.id, route: 'cancel', userId }); }
  }
}
