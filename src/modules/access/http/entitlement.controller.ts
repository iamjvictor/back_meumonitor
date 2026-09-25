import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/errors/app-error.js';
import type { EntitlementService } from '../application/entitlement.service.js';

export class EntitlementController {
  constructor(private readonly service: EntitlementService, private readonly findStudentId: (userId: string) => Promise<string | null>) {}
  async get(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão de usuário obrigatória.' });
    const studentId = await this.findStudentId(request.user.id);
    if (!studentId) throw new AppError({ code: 'STUDENT_NOT_FOUND', statusCode: 404, publicMessage: 'Aluno não encontrado.' });
    return reply.send({ data: await this.service.getSnapshot(studentId) });
  }
}
