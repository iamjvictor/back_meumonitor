import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { StudentNotFoundError } from './student-access.service.js';
import type { StudentAccessController } from './student-access.controller.js';

const monitorParams = z.object({ monitorId: z.string().min(1) });

export async function studentAccessRoutes(app: FastifyInstance, controller: StudentAccessController) {
  app.post('/student/monitors/:monitorId/cancel', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = monitorParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' });

    try {
      await controller.cancelMonitorAccess({ userId: request.user.id, monitorId: params.data.monitorId });
      return reply.send({ success: true, message: 'Assinatura cancelada com sucesso.' });
    } catch (error) {
      if (error instanceof StudentNotFoundError) {
        return reply.code(404).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
