import type { FastifyInstance } from 'fastify';
import type { StudentAccessController } from './student-access.controller.js';

export async function studentAccessRoutes(app: FastifyInstance, _controller: StudentAccessController) {
  app.post('/student/monitors/:monitorId/cancel', async (_request, reply) => {
    return reply.code(410).send({
      code: 'LEGACY_CANCELLATION_DISABLED',
      message: 'Use a rota canônica de cancelamento da assinatura financeira.',
    });
  });
}
