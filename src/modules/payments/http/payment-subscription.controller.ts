import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import type { PaymentSubscriptionRepository } from '../infrastructure/persistence/payment-subscription.repository.js';
import type { PaymentSubscriptionService } from '../application/services/payment-subscription.service.js';

const paramsSchema = z.object({ subscriptionId: z.string().uuid(), monitorId: z.string().uuid() });

export class PaymentSubscriptionController {
  constructor(private readonly repository: PaymentSubscriptionRepository, private readonly service: PaymentSubscriptionService) {}

  private student(request: FastifyRequest) {
    if (!request.user || request.user.role?.toLowerCase() !== 'student') throw new AppError({ code: 'FORBIDDEN', statusCode: 403, publicMessage: 'Sessão de aluno obrigatória.' });
    return request.user;
  }

  private async studentId(request: FastifyRequest) {
    const user = this.student(request);
    const studentId = await this.repository.findStudentIdByUserId(user.id);
    if (!studentId) throw new AppError({ code: 'STUDENT_NOT_FOUND', statusCode: 404, publicMessage: 'Aluno não encontrado.' });
    return { user, studentId };
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { studentId } = await this.studentId(request);
    const data = await this.repository.listForStudent(studentId);
    return reply.send({ data });
  }

  async detail(request: FastifyRequest, reply: FastifyReply) {
    const { studentId } = await this.studentId(request);
    const parsed = z.object({ subscriptionId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Assinatura inválida.' });
    const data = await this.repository.detailForStudent(studentId, parsed.data.subscriptionId);
    if (!data) throw new AppError({ code: 'SUBSCRIPTION_NOT_FOUND', statusCode: 404, publicMessage: 'Assinatura não encontrada.' });
    return reply.send({ data });
  }

  async history(request: FastifyRequest, reply: FastifyReply) {
    const { studentId } = await this.studentId(request);
    return reply.send({ data: await this.repository.historyForStudent(studentId) });
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    const { user, studentId } = await this.studentId(request);
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Assinatura inválida.' });
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new AppError({ code: 'IDEMPOTENCY_KEY_REQUIRED', statusCode: 422, publicMessage: 'A chave de idempotência é obrigatória.' });
    try {
      const data = await this.service.cancelItem(studentId, parsed.data.subscriptionId, parsed.data.monitorId, user.id, idempotencyKey.trim());
      return reply.send({ data });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
      const status = code === 'SUBSCRIPTION_NOT_FOUND' || code === 'SUBSCRIPTION_ITEM_NOT_FOUND' ? 404 : code === 'SUBSCRIPTION_NOT_ACTIVE' || code === 'IDEMPOTENCY_IN_PROGRESS' ? 409 : code === 'IDEMPOTENCY_KEY_REQUIRED' ? 422 : 500;
      throw new AppError({ code, statusCode: status, publicMessage: status === 500 ? 'Não foi possível cancelar a assinatura.' : 'Assinatura não disponível para cancelamento.' });
    }
  }
}
