import type { FastifyReply, FastifyRequest } from 'fastify';
import { registerTeacherProfileSchema } from '../models/teacher-registration.model.js';
import { TeacherRegistrationService } from '../services/teacher-registration.service.js';

export class TeacherRegistrationController {
  constructor(private readonly service: TeacherRegistrationService) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now();
    console.log('Perfil do professor recebido', {
      event: 'teacher_profile.request_received',
      requestId: request.id,
      method: request.method,
      url: request.url,
      userId: request.user?.id,
      role: request.user?.role,
      receivedFields: request.body && typeof request.body === 'object' ? Object.keys(request.body) : [],
    });

    const result = registerTeacherProfileSchema.safeParse(request.body);
    if (!result.success) {
      console.log('Perfil invalido', { event: 'teacher_profile.validation_failed', requestId: request.id, durationMs: Date.now() - startedAt, invalidFields: Object.keys(result.error.flatten().fieldErrors) });
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Dados do perfil invalidos.', details: result.error.flatten().fieldErrors });
    }

    console.log('Perfil validado', {
      event: 'teacher_profile.validation_succeeded',
      requestId: request.id,
      userId: request.user?.id,
      username: result.data.username,
      pageSlug: result.data.pageSlug,
      area: result.data.area,
      optionalFields: {
        customArea: Boolean(result.data.customArea),
        bio: Boolean(result.data.bio),
        avatarUrl: Boolean(result.data.avatarUrl),
        instagram: Boolean(result.data.instagram),
        tiktok: Boolean(result.data.tiktok),
        youtube: Boolean(result.data.youtube),
      },
    });

    if (!request.user) {
      console.log('Sessao ausente', { event: 'teacher_profile.session_missing', requestId: request.id, durationMs: Date.now() - startedAt });
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }
    if (request.user.role !== 'teacher') {
      console.log('Role sem permissao para perfil de professor', { event: 'teacher_profile.forbidden_role', requestId: request.id, userId: request.user.id, role: request.user.role, durationMs: Date.now() - startedAt });
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas contas de professor podem completar este perfil.' });
    }

    try {
      console.log('Persistencia do perfil iniciada', { event: 'teacher_profile.persistence_started', requestId: request.id, userId: request.user.id });
      const teacher = await this.service.execute(request.user, result.data);
      console.log('Perfil do professor concluido', { event: 'teacher_profile.completed', requestId: request.id, userId: request.user.id, teacherId: teacher.id, status: teacher.status, durationMs: Date.now() - startedAt });
      return reply.code(201).send({ data: teacher });
    } catch (error) {
      console.log('Falha ao registrar perfil', { event: 'teacher_profile.failed', requestId: request.id, userId: request.user.id, durationMs: Date.now() - startedAt, error });
      return reply.code(500).send({ error: 'PROFILE_REGISTRATION_FAILED', message: 'Nao foi possivel salvar o perfil.' });
    }
  }
}
