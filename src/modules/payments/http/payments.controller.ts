import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import {
  CheckoutIdempotencyKeyRequiredError,
  CheckoutIdempotencyKeyReusedError,
  CheckoutMonitorNotFoundError,
  CheckoutPendingError,
  CheckoutStudentNotFoundError,
  CheckoutStudentRoleError,
  CreateCheckoutUseCase,
} from '../application/commands/create-checkout.use-case.js';

export const createCheckoutBodySchema = z.object({ monitorId: z.string().uuid() }).strict();

export class PaymentsController {
  constructor(private readonly createCheckout: CreateCheckoutUseCase, private readonly returnBaseUrl: string) {}

  async create(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão de aluno obrigatória.' });
    if (request.user.role?.toLowerCase() !== 'student') throw new AppError({ code: 'FORBIDDEN', statusCode: 403, publicMessage: 'Somente alunos podem iniciar uma assinatura.' });
    const parsed = createCheckoutBodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Monitor inválido.', internalDetails: parsed.error.flatten() });
    const idempotencyKey = headerValue(request.headers['idempotency-key']);
    console.log('Criação de checkout Asaas solicitada', { event: 'payments.checkout_creation_requested', requestId: request.id, userId: request.user.id, monitorId: parsed.data.monitorId, hasIdempotencyKey: Boolean(idempotencyKey) });
    try {
      const result = await this.createCheckout.execute(request.user.id, { monitorId: parsed.data.monitorId, idempotencyKey: idempotencyKey ?? '', returnBaseUrl: this.returnBaseUrl });
      console.log('Checkout Asaas criado', { event: 'payments.checkout_creation_completed', requestId: request.id, userId: request.user.id, orderId: result.orderId, subscriptionId: result.subscriptionId, amountCents: result.amountCents, hasCheckoutUrl: Boolean(result.checkoutUrl) });
      return reply.code(201).send({ data: result });
    } catch (error) {
      if (error instanceof CheckoutIdempotencyKeyRequiredError) throw new AppError({ code: 'IDEMPOTENCY_KEY_REQUIRED', statusCode: 422, publicMessage: 'A chave de idempotência é obrigatória.' });
      if (error instanceof CheckoutIdempotencyKeyReusedError) throw new AppError({ code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409, publicMessage: 'A chave de idempotência já foi usada com outros dados.' });
      if (error instanceof CheckoutPendingError) throw new AppError({ code: 'CHECKOUT_PENDING', statusCode: 409, publicMessage: 'Já existe um checkout em processamento para esta solicitação. Aguarde a reconciliação.' });
      if (error instanceof CheckoutStudentNotFoundError) throw new AppError({ code: 'STUDENT_NOT_FOUND', statusCode: 404, publicMessage: 'Perfil de aluno não encontrado.' });
      if (error instanceof CheckoutStudentRoleError) throw new AppError({ code: 'FORBIDDEN', statusCode: 403, publicMessage: 'Somente alunos podem iniciar uma assinatura.' });
      if (error instanceof CheckoutMonitorNotFoundError) throw new AppError({ code: 'MONITOR_NOT_FOUND', statusCode: 404, publicMessage: 'Monitor não encontrado ou não publicado.' });
      throw error;
    }
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
