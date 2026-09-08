import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import type { StudentProfileController } from './student-profile.controller.js';

const profileBody = z.object({
  fullName: z.string().optional(),
  phone: z.string().optional(),
  cpf: z.string().optional(),
  avatarUrl: z.string().optional(),
}).strict();

export async function studentProfileRoutes(
  app: FastifyInstance,
  controller: StudentProfileController,
) {
  app.put('/student/profile', { onRequest: authMiddleware }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const body = profileBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados de perfil inválidos.',
        details: body.error.flatten(),
      });
    }

    const data = await controller.updateProfile(request.user, body.data);
    return reply.send({ data });
  });
}
