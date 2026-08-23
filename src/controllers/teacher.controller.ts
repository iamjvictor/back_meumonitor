import type { FastifyReply, FastifyRequest } from 'fastify';
import { TeacherService } from '../services/teacher.service.js';

export class TeacherController {
  constructor(private readonly service: TeacherService) {}

  async getMyProfile(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now();

    if (!request.user) {
      console.log('Busca de perfil sem sessao', {
        event: 'teacher.profile_lookup_unauthenticated',
        requestId: request.id,
      });
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }

    if (request.user.role !== 'teacher') {
      console.log('Busca de perfil bloqueada por role', {
        event: 'teacher.profile_lookup_forbidden',
        requestId: request.id,
        userId: request.user.id,
        role: request.user.role,
      });
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas contas de professor podem acessar este perfil.' });
    }

    console.log('Busca de meu perfil recebida', {
      event: 'teacher.profile_lookup_received',
      requestId: request.id,
      userId: request.user.id,
    });

    try {
      const teacher = await this.service.findMyProfile(request.user.id);

      if (!teacher) {
        console.log('Perfil do professor nao encontrado', {
          event: 'teacher.profile_not_found',
          requestId: request.id,
          userId: request.user.id,
          durationMs: Date.now() - startedAt,
        });
        return reply.code(404).send({
          error: 'TEACHER_PROFILE_NOT_FOUND',
          message: 'Perfil do professor ainda nao foi criado.',
          hasProfile: false,
          user: {
            id: request.user.id,
            fullName: request.user.fullName,
            email: request.user.email,
          },
        });
      }

      console.log('Meu perfil enviado para o frontend', {
        event: 'teacher.profile_lookup_completed',
        requestId: request.id,
        userId: request.user.id,
        teacherId: teacher.id,
        status: teacher.status,
        durationMs: Date.now() - startedAt,
      });

      return reply.code(200).send({ data: teacher });
    } catch (error) {
      console.log('Falha ao buscar perfil do professor', {
        event: 'teacher.profile_lookup_failed',
        requestId: request.id,
        userId: request.user.id,
        durationMs: Date.now() - startedAt,
        error,
      });
      return reply.code(500).send({ error: 'TEACHER_PROFILE_LOOKUP_FAILED', message: 'Nao foi possivel buscar o perfil.' });
    }
  }

  async getPublicProfile(request: FastifyRequest<{ Params: { teacherSlug: string } }>, reply: FastifyReply) {
    const { teacherSlug } = request.params;

    try {
      const teacher = await this.service.findPublicProfile(teacherSlug);

      if (!teacher) {
        return reply.code(404).send({ error: 'TEACHER_PAGE_NOT_FOUND', message: 'Pagina do professor nao encontrada.' });
      }

      return reply.code(200).send({ data: teacher });
    } catch (error) {
      console.log('Falha ao buscar pagina publica do professor', {
        event: 'teacher.public_profile_lookup_failed',
        pageSlug: teacherSlug,
        error,
      });
      return reply.code(500).send({ error: 'PUBLIC_PROFILE_LOOKUP_FAILED', message: 'Nao foi possivel carregar a pagina.' });
    }
  }
}
