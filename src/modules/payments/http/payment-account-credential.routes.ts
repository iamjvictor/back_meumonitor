import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import { AppError } from '../../../core/errors/app-error.js';
import { RotatePaymentAccountCredentialUseCase } from '../application/commands/rotate-payment-account-credential.use-case.js';

const body = z.object({ operationKey: z.string().trim().min(1).max(120), environment: z.enum(['sandbox', 'production']), credential: z.string().min(1).max(4096) }).strict();
const revokeBody = z.object({ operationKey: z.string().trim().min(1).max(120), environment: z.enum(['sandbox', 'production']) }).strict();
function teacher(request: FastifyRequest) { if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão obrigatória.' }); if (!['teacher', 'professor'].includes(request.user.role?.toLowerCase() ?? '')) throw new AppError({ code: 'FORBIDDEN', statusCode: 403, publicMessage: 'Sessão de professor obrigatória.' }); return request.user.id; }
export async function paymentAccountCredentialRoutes(app: FastifyInstance, useCase: RotatePaymentAccountCredentialUseCase) {
  app.post('/teachers/me/payment-account/credential/rotate', { onRequest: authMiddleware }, async (request, reply: FastifyReply) => { const userId = teacher(request); const parsed = body.safeParse(request.body); if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados inválidos.' }); return reply.send({ data: await useCase.execute({ userId, ...parsed.data }) }); });
  app.post('/teachers/me/payment-account/credential/revoke', { onRequest: authMiddleware }, async (request, reply: FastifyReply) => { const userId = teacher(request); const parsed = revokeBody.safeParse(request.body); if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados inválidos.' }); return reply.send({ data: await useCase.revoke({ userId, ...parsed.data }) }); });
}
