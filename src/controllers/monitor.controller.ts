import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../core/errors/app-error.js';
import { createMonitorSchema, monitorIdParamsSchema, updateMonitorSchema } from '../models/monitor.model.js';
import { MonitorService } from '../services/monitor.service.js';
import { MonitorPublicationBlockedError } from '../repositories/monitor.repository.js';

export const addSubjectBodySchema = z.object({ name: z.string().trim().min(1).max(120), topics: z.array(z.string().trim().min(1).max(120)).min(1).max(30) }).strict();
export const addTopicBodySchema = z.object({ name: z.string().trim().min(1).max(120), definition: z.string().trim().max(4000).optional() }).strict();
export const publicationExceptionBodySchema = z.object({ allowPublishWithoutPaymentAccount: z.boolean() }).strict();

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
        validationIssues: parsed.error.issues,
        receivedBody: request.body,
      });
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados do Monitor de IA invalidos.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    console.log('Payload de criação de Monitor recebido', {
      event: 'monitor.create_payload_received',
      requestId: request.id,
      userId: request.user.id,
      payload: parsed.data,
    });

    try {
      const result = await this.service.createDraft(request.user.id, parsed.data);

      if (result.kind === 'TEACHER_NOT_FOUND') {
        return reply.code(404).send({ error: 'TEACHER_PROFILE_NOT_FOUND', message: 'Conclua o perfil de professor antes de criar um monitor.' });
      }
      if (result.kind === 'TEACHER_NOT_ACTIVE') {
        return reply.code(403).send({ error: 'TEACHER_PROFILE_NOT_ACTIVE', message: 'Seu perfil precisa estar ativo para criar um monitor.' });
      }
      if (result.kind === 'PAYMENT_ACCOUNT_REQUIRED') {
        return reply.code(403).send({
          error: 'PAYMENT_ACCOUNT_REQUIRED_FOR_CREATION',
          message: 'Configure e aguarde a aprovação da conta de recebimento antes de criar um monitor.',
        });
      }

      console.log('Monitor de IA salvo como rascunho', {
        event: 'monitor.create_completed',
        requestId: request.id,
        userId: request.user.id,
        monitorId: result.monitor.id,
        status: result.monitor.status,
        materialization: result.materialization,
        durationMs: Date.now() - startedAt,
      });
      return reply.code(201).send({
        data: result.monitor,
        materialization: result.materialization,
      });
    } catch (error) {
      console.log('Falha ao criar Monitor de IA', {
        event: 'monitor.create_failed',
        requestId: request.id,
        userId: request.user.id,
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return reply.code(500).send({ error: 'MONITOR_CREATION_FAILED', message: 'Nao foi possivel criar o Monitor de IA.' });
    }
  }

  async listMine(request: FastifyRequest, reply: FastifyReply) {
    console.log('[MonitorController.listMine] Requisicao recebida:', {
      requestId: request.id,
      userId: request.user?.id,
      userRole: request.user?.role,
    });

    if (!request.user) {
      console.log('[MonitorController.listMine] Nao autenticado.');
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }

    const isTeacherRole = ['teacher', 'professor', 'admin'].includes(request.user.role?.toLowerCase() || '');
    let isTeacher = isTeacherRole;

    if (!isTeacher) {
      // Fallback: check if teacher record exists in DB
      const { TeacherRepository } = await import('../repositories/teacher.repository.js');
      const teacherRepo = new TeacherRepository();
      const teacher = await teacherRepo.findByUserId(request.user.id);
      if (teacher) isTeacher = true;
    }

    console.log('[MonitorController.listMine] Status de autorizacao:', {
      userId: request.user.id,
      tokenRole: request.user.role,
      isTeacherAllowed: isTeacher,
    });

    if (!isTeacher) {
      console.log('[MonitorController.listMine] Acesso negado: usuario nao e professor.');
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem acessar Monitores de IA.' });
    }

    try {
      const monitors = await this.service.findAllOwnedByUserId(request.user.id);
      console.log('[MonitorController.listMine] Monitores encontrados:', {
        userId: request.user.id,
        count: monitors.length,
        monitorIds: monitors.map((m) => m.id),
      });
      return reply.code(200).send({ data: monitors });
    } catch (error) {
      console.log('[MonitorController.listMine] Erro ao listar Monitores:', { requestId: request.id, userId: request.user.id, errorType: error instanceof Error ? error.name : 'UnknownError' });
      return reply.code(500).send({ error: 'MONITOR_LIST_FAILED', message: 'Nao foi possivel listar os Monitores de IA.' });
    }
  }

  async getMine(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    const isTeacher = ['teacher', 'professor', 'admin'].includes(request.user.role?.toLowerCase() || '');
    if (!isTeacher) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem acessar Monitores de IA.' });

    const params = monitorIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Identificador de monitor invalido.' });

    try {
      const monitor = await this.service.findOwnedByUserId(request.user.id, params.data.monitorId);
      if (!monitor) return reply.code(404).send({ error: 'MONITOR_NOT_FOUND', message: 'Monitor de IA nao encontrado.' });

      return reply.code(200).send({ data: monitor });
    } catch (error) {
      console.log('Falha ao buscar Monitor de IA', { event: 'monitor.lookup_failed', requestId: request.id, userId: request.user.id, monitorId: params.data.monitorId, errorType: error instanceof Error ? error.name : 'UnknownError' });
      return reply.code(500).send({ error: 'MONITOR_LOOKUP_FAILED', message: 'Nao foi possivel carregar o Monitor de IA.' });
    }
  }

  async addSubject(request: FastifyRequest<{ Params: { monitorId: string }; Body: { name: string; topics?: string[] } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    const parsed = addSubjectBodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados da matéria inválidos.', internalDetails: parsed.error.flatten() });
    const { name, topics } = parsed.data;

    try {
      const monitor = await this.service.addSubject(request.user.id, request.params.monitorId, name, topics);
      if (!monitor) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Monitor nao encontrado.' });
      return reply.code(201).send({ data: monitor });
    } catch (cause) {
      throw new AppError({ code: 'ADD_SUBJECT_FAILED', statusCode: 500, publicMessage: 'Falha ao adicionar matéria.', cause });
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
    const parsed = addTopicBodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: 'Dados do tópico inválidos.', internalDetails: parsed.error.flatten() });
    const { name, definition } = parsed.data;

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

  async update(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem alterar Monitores de IA.' });

    const params = monitorIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Identificador de monitor invalido.' });

    const parsed = updateMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados do Monitor de IA invalidos.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const monitor = await this.service.update(request.user.id, params.data.monitorId, parsed.data);
      if (!monitor) return reply.code(404).send({ error: 'MONITOR_NOT_FOUND', message: 'Monitor de IA nao encontrado.' });

      return reply.code(200).send({ data: monitor });
    } catch (error) {
      if (error instanceof MonitorPublicationBlockedError) {
        return reply.code(403).send({ error: 'PAYMENT_ACCOUNT_REQUIRED_FOR_PUBLICATION', message: 'Configure uma conta de recebimento aprovada antes de publicar o monitor.' });
      }
      console.log('Falha ao atualizar Monitor de IA', { event: 'monitor.update_failed', requestId: request.id, userId: request.user.id, monitorId: params.data.monitorId, errorType: error instanceof Error ? error.name : 'UnknownError' });
      return reply.code(500).send({ error: 'MONITOR_UPDATE_FAILED', message: 'Nao foi possivel atualizar o Monitor de IA.' });
    }
  }

  async setPublicationException(request: FastifyRequest<{ Params: { monitorId: string }; Body: { allowPublishWithoutPaymentAccount?: boolean } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessão obrigatória.' });
    if (request.user.role?.toLowerCase() !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores podem liberar publicação sem conta.' });
    const params = monitorIdParamsSchema.safeParse(request.params);
    const body = publicationExceptionBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Dados de dispensa inválidos.' });
    const monitor = await this.service.setPublicationException(request.user.id, params.data.monitorId, body.data.allowPublishWithoutPaymentAccount);
    if (!monitor) return reply.code(404).send({ error: 'MONITOR_NOT_FOUND', message: 'Monitor não encontrado.' });
    return reply.send({ data: monitor });
  }

  async getQuestionBankCatalog(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }

    try {
      const catalog = await this.service.getQuestionBankCatalog();
      return reply.code(200).send({ data: catalog });
    } catch (error) {
      console.log('Falha ao consultar catalogo do banco de questoes', {
        event: 'question_bank.catalog_failed',
        requestId: request.id,
        userId: request.user.id,
        error: error instanceof Error ? error.message : 'UnknownError',
      });
      return reply.code(500).send({ error: 'QUESTION_BANK_CATALOG_FAILED', message: 'Nao foi possivel carregar o catalogo de questoes.' });
    }
  }
}
