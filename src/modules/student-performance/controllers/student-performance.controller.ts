import type { FastifyReply, FastifyRequest } from 'fastify';
import { StudentPerformanceService } from '../services/student-performance.service.js';

export class StudentPerformanceController {
  constructor(private readonly service = new StudentPerformanceService()) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      return reply.send({ data: await this.service.getForUser(request.user.id) });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const status = code === 'STUDENT_NOT_FOUND' ? 404 : 500;
      return reply.code(status).send({ error: status === 404 ? code : 'INTERNAL_SERVER_ERROR', message: 'Não foi possível carregar o desempenho.' });
    }
  }
}
