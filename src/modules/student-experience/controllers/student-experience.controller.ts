import type { FastifyReply, FastifyRequest } from 'fastify';
import { StudentExperienceService } from '../services/student-experience.service.js';

export class StudentExperienceController {
  constructor(private readonly service = new StudentExperienceService()) {}

  async get(
    request: FastifyRequest<{ Querystring: { monitorId?: string; period?: 'week' | 'month' | 'all'; month?: string } }>,
    reply: FastifyReply
  ) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    try {
      const data = await this.service.getExperience(request.user.id, {
        monitorId: request.query.monitorId,
        period: request.query.period,
        month: request.query.month,
      });
      return reply.send({ data });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const status = code === 'STUDENT_NOT_FOUND' ? 404 : 500;
      return reply.code(status).send({
        error: status === 404 ? code : 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível carregar os dados de experiência.',
      });
    }
  }
}
