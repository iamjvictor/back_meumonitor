import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../core/errors/app-error.js';
import { createPurchaseSchema, type CreatePurchaseInput } from '../models/student-purchase.model.js';
import type { StudentPurchaseService } from '../services/student-purchase.service.js';

type PurchaseParams = { purchaseId: string };
type PurchaseHeaders = { 'idempotency-key'?: string | string[]; 'x-simulated-session'?: string | string[] };
type PurchaseRequest<B = unknown, P = PurchaseParams> = FastifyRequest<{ Body: B; Params: P; Headers: PurchaseHeaders }>;
type StudentPurchaseServicePort = {
  createPurchase(userId: string, input: CreatePurchaseInput, key: string): Promise<unknown>;
  simulatedCheckout(userId: string, purchaseId: string): Promise<unknown>;
  simulatedConfirmation(userId: string, purchaseId: string, sessionId: string): Promise<unknown>;
  listPurchases(userId: string): Promise<unknown>;
  listPaymentHistory(userId: string): Promise<unknown>;
  listSubscriptions(userId: string): Promise<unknown>;
};

const errorStatuses: Record<string, number> = {
  STUDENT_NOT_FOUND: 404,
  PURCHASE_NOT_FOUND: 404,
  MONITOR_NOT_PUBLISHED: 422,
  DUPLICATE_MONITOR: 422,
  ACTIVE_SUBSCRIPTION: 409,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  IDEMPOTENCY_KEY_REUSED: 409,
  SIMULATION_DISABLED: 503,
  INVALID_CHECKOUT_SESSION: 422,
  SESSION_EXPIRED: 422,
  CHECKOUT_AMOUNT_MISMATCH: 409,
  PURCHASE_NOT_PENDING: 409,
  PURCHASE_NOT_CONFIRMABLE: 409,
};

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(event, { event, ...data });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export class StudentPurchaseController {
  constructor(private readonly service: StudentPurchaseServicePort) {}

  private domainError(error: unknown) {
    const code = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return new AppError({
      code: errorStatuses[code] ? code : 'INTERNAL_SERVER_ERROR',
      statusCode: errorStatuses[code] ?? 500,
      publicMessage: errorStatuses[code] ? 'Não foi possível processar a solicitação.' : 'Erro interno do servidor.',
      internalDetails: { originalCode: code },
      cause: error,
    });
  }

  private requireUser(request: FastifyRequest) {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão de usuário obrigatória.' });
    return request.user.id;
  }

  async create(request: PurchaseRequest<CreatePurchaseInput>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    const parsed = createPurchaseSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados de compra inválidos.', internalDetails: parsed.error.flatten() });
    const key = headerValue(request.headers['idempotency-key']);
    log('monitor.student_purchase_http_create_started', { requestId: request.id, userId, monitorCount: parsed.data.monitorIds.length, hasIdempotencyKey: Boolean(key) });
    try {
      const data = await this.service.createPurchase(userId, parsed.data, key ?? '');
      const result = data as { purchaseId?: string; id?: string; status?: string; checkoutUrl?: string };
      log('monitor.student_purchase_http_create_completed', { requestId: request.id, purchaseId: result.purchaseId ?? result.id, status: result.status, checkoutUrlCreated: Boolean(result.checkoutUrl) });
      return reply.code(201).send({ data });
    } catch (error) { throw this.domainError(error); }
  }

  async checkout(request: PurchaseRequest<unknown>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    try { return reply.send({ data: await this.service.simulatedCheckout(userId, request.params.purchaseId) }); }
    catch (error) { throw this.domainError(error); }
  }

  async confirm(request: PurchaseRequest<{ sessionId?: string }>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    const headerSession = headerValue(request.headers['x-simulated-session']);
    const sessionId = headerSession ?? request.body?.sessionId;
    if (!sessionId) throw new AppError({ code: 'SESSION_REQUIRED', statusCode: 422, publicMessage: 'Sessão de checkout obrigatória.' });
    try { return reply.send({ data: await this.service.simulatedConfirmation(userId, request.params.purchaseId, sessionId) }); }
    catch (error) { throw this.domainError(error); }
  }

  async purchases(request: PurchaseRequest<unknown>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    try { return reply.send({ data: await this.service.listPurchases(userId) }); }
    catch (error) { throw this.domainError(error); }
  }

  async paymentHistory(request: PurchaseRequest<unknown>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    try { return reply.send({ data: await this.service.listPaymentHistory(userId) }); }
    catch (error) { throw this.domainError(error); }
  }

  async subscriptions(request: PurchaseRequest<unknown>, reply: FastifyReply) {
    const userId = this.requireUser(request);
    try { return reply.send({ data: await this.service.listSubscriptions(userId) }); }
    catch (error) { throw this.domainError(error); }
  }
}
