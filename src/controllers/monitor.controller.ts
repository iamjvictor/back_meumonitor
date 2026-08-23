import type { FastifyReply, FastifyRequest } from 'fastify';
import { createMonitorSchema, monitorIdParamsSchema } from '../models/monitor.model.js';
import { MonitorService } from '../services/monitor.service.js';

export class MonitorController {
  constructor(private readonly service: MonitorService) {}

  async createDraft(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now();

    if (!request.user) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }
    if (request.user.role !== 'teacher') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem criar Monitores de IA.' });
    }

    const parsed = createMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      console.log('Criacao de Monitor de IA rejeitada na validacao', {
        event: 'monitor.create_validation_failed',
        requestId: request.id,
        userId: request.user.id,
        invalidFields: Object.keys(parsed.error.flatten().fieldErrors),
      });
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados do Monitor de IA invalidos.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await this.service.createDraft(request.user.id, parsed.data);

      if (result.kind === 'TEACHER_NOT_FOUND') {
        return reply.code(404).send({ error: 'TEACHER_PROFILE_NOT_FOUND', message: 'Conclua o perfil de professor antes de criar um monitor.' });
      }
      if (result.kind === 'TEACHER_NOT_ACTIVE') {
        return reply.code(403).send({ error: 'TEACHER_PROFILE_NOT_ACTIVE', message: 'Seu perfil precisa estar ativo para criar um monitor.' });
      }

      console.log('Monitor de IA salvo como rascunho', {
        event: 'monitor.create_completed',
        requestId: request.id,
        userId: request.user.id,
        monitorId: result.monitor.id,
        status: result.monitor.status,
        durationMs: Date.now() - startedAt,
      });
      return reply.code(201).send({ data: result.monitor });
    } catch (error) {
      console.log('Falha ao criar Monitor de IA', {
        event: 'monitor.create_failed',
        requestId: request.id,
        userId: request.user.id,
        durationMs: Date.now() - startedAt,
        error,
      });
      return reply.code(500).send({ error: 'MONITOR_CREATION_FAILED', message: 'Nao foi possivel criar o Monitor de IA.' });
    }
  }

  async listMine(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem acessar Monitores de IA.' });

    try {
      const monitors = await this.service.findAllOwnedByUserId(request.user.id);
      return reply.code(200).send({ data: monitors });
    } catch (error) {
      console.log('Falha ao listar Monitores de IA', { event: 'monitor.list_failed', requestId: request.id, userId: request.user.id, error });
      return reply.code(500).send({ error: 'MONITOR_LIST_FAILED', message: 'Nao foi possivel listar os Monitores de IA.' });
    }
  }

  async getMine(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem acessar Monitores de IA.' });

    const params = monitorIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Identificador de monitor invalido.' });

    try {
      const monitor = await this.service.findOwnedByUserId(request.user.id, params.data.monitorId);
      if (!monitor) return reply.code(404).send({ error: 'MONITOR_NOT_FOUND', message: 'Monitor de IA nao encontrado.' });

      return reply.code(200).send({ data: monitor });
    } catch (error) {
      console.log('Falha ao buscar Monitor de IA', { event: 'monitor.lookup_failed', requestId: request.id, userId: request.user.id, monitorId: params.data.monitorId, error });
      return reply.code(500).send({ error: 'MONITOR_LOOKUP_FAILED', message: 'Nao foi possivel carregar o Monitor de IA.' });
    }
  }

  async addSubject(request: FastifyRequest<{ Params: { monitorId: string }; Body: { name: string; topics?: string[] } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    const { name, topics } = (request.body as any) || {};
    if (!name || !name.trim()) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Nome da materia e obrigatorio.' });

    const topicsArray = Array.isArray(topics) ? topics : [];
    if (topicsArray.filter((t: any) => typeof t === 'string' && t.trim()).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'É necessário fornecer pelo menos 1 tópico válido.' });
    }

    try {
      const monitor = await this.service.addSubject(request.user.id, request.params.monitorId, name, topicsArray);
      if (!monitor) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Monitor nao encontrado.' });
      return reply.code(201).send({ data: monitor });
    } catch (error) {
      return reply.code(500).send({ error: 'ADD_SUBJECT_FAILED', message: 'Falha ao adicionar materia.' });
    }
  }

  async deleteSubject(request: FastifyRequest<{ Params: { monitorId: string; subjectId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });

    try {
      const monitor = await this.service.deleteSubject(request.user.id, request.params.monitorId, request.params.subjectId);
      if (!monitor) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Monitor ou materia nao encontrada.' });
      return reply.code(200).send({ data: monitor });
    } catch (error) {
      return reply.code(500).send({ error: 'DELETE_SUBJECT_FAILED', message: 'Falha ao remover materia.' });
    }
  }

  async addTopic(request: FastifyRequest<{ Params: { monitorId: string; subjectId: string }; Body: { name: string; definition?: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    const { name, definition } = (request.body as any) || {};
    if (!name || !name.trim()) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Nome do topico e obrigatorio.' });
    if (definition !== undefined && (typeof definition !== 'string' || definition.trim().length > 4000)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'A definicao do topico deve ter no maximo 4000 caracteres.' });
    }

    try {
      const monitor = await this.service.addTopic(request.user.id, request.params.monitorId, request.params.subjectId, name, definition);
      if (!monitor) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Materia nao encontrada.' });
      return reply.code(201).send({ data: monitor });
    } catch (error) {
      return reply.code(500).send({ error: 'ADD_TOPIC_FAILED', message: 'Falha ao adicionar topico.' });
    }
  }

  async deleteTopic(request: FastifyRequest<{ Params: { monitorId: string; subjectId: string; topicId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });

    try {
      const monitor = await this.service.deleteTopic(request.user.id, request.params.monitorId, request.params.subjectId, request.params.topicId);
      if (!monitor) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Topico nao encontrado.' });
      return reply.code(200).send({ data: monitor });
    } catch (error) {
      return reply.code(500).send({ error: 'DELETE_TOPIC_FAILED', message: 'Falha ao remover topico.' });
    }
  }
}
