import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import type { StudentProfileController } from './student-profile.controller.js';
import { AppError } from '../../core/errors/app-error.js';

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
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessao de usuario obrigatoria.' });

    const body = profileBody.safeParse(request.body ?? {});
    if (!body.success) {
      throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados de perfil inválidos.', internalDetails: body.error.flatten() });
    }

    const data = await controller.updateProfile(request.user, body.data);
    return reply.send({ data });
  });
}
