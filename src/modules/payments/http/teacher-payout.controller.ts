import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/errors/app-error.js';
import type { TeacherPayoutRepository } from '../infrastructure/persistence/teacher-payout.repository.js';
import { TeacherPayoutService } from '../application/services/teacher-payout.service.js';
import { prisma } from '../../../lib/prisma.js';

export class TeacherPayoutController {
  private readonly service: TeacherPayoutService;

  constructor(private readonly repository: TeacherPayoutRepository) {
    this.service = new TeacherPayoutService(repository);
  }

  private async teacher(request: FastifyRequest) {
    if (!request.user || request.user.role?.toLowerCase() !== 'teacher') throw new AppError({ code: 'FORBIDDEN', statusCode: 403, publicMessage: 'Sessão de professor obrigatória.' });
    const teacher = await prisma.teacher.findUnique({ where: { userId: request.user.id }, select: { id: true } });
    if (!teacher) throw new AppError({ code: 'TEACHER_NOT_FOUND', statusCode: 404, publicMessage: 'Perfil de professor não encontrado.' });
    return teacher.id;
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ data: await this.service.list(await this.teacher(request)) });
  }

  async summary(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.service.list(await this.teacher(request));
    return reply.send({ data: result.summary });
  }
}
