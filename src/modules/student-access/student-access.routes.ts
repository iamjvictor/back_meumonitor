import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { StudentNotFoundError } from './student-access.service.js';
import type { StudentAccessController } from './student-access.controller.js';
import { AppError } from '../../core/errors/app-error.js';

const monitorParams = z.object({ monitorId: z.string().min(1) });

export async function studentAccessRoutes(app: FastifyInstance, controller: StudentAccessController) {
  app.post('/student/monitors/:monitorId/cancel', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessao de usuario obrigatoria.' });

    const params = monitorParams.safeParse(request.params);
    if (!params.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados inválidos.', internalDetails: params.error.flatten() });

    try {
      await controller.cancelMonitorAccess({ userId: request.user.id, monitorId: params.data.monitorId });
      return reply.send({ success: true, message: 'Assinatura cancelada com sucesso.' });
    } catch (error) {
      if (error instanceof StudentNotFoundError) {
        throw new AppError({ code: error.code, statusCode: 404, publicMessage: error.message });
      }
      throw error;
    }
  });
}
