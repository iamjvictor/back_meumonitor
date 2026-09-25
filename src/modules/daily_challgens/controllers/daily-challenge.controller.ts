import type { FastifyReply, FastifyRequest } from 'fastify';
import { answerChallengeSchema, rankingMonthSchema } from '../models/daily-challenge.model.js';
import { DailyChallengeService } from '../services/daily-challenge.service.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

const errors: Record<string, number> = { STUDENT_NOT_FOUND: 404, ENROLLMENT_REQUIRED: 403, CHALLENGE_NOT_FOUND: 404, CHALLENGE_EXPIRED: 422 };

export class DailyChallengeController {
  constructor(private readonly service = new DailyChallengeService()) {}

  private fail(reply: FastifyReply, error: unknown, context: Record<string, unknown>) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log('monitor.daily_challenge_http_failed', { ...context, errorCode: code, statusCode: errors[code] ?? 500 });
    return reply.code(errors[code] ?? 500).send({ error: errors[code] ? code : 'INTERNAL_SERVER_ERROR', message: 'Não foi possível processar o desafio diário.' });
  }

  async current(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try { return reply.send({ data: await this.service.getCurrent(request.user.id, request.params.monitorId) }); }
    catch (error) { return this.fail(reply, error, { route: 'current', requestId: request.id, monitorId: request.params.monitorId }); }
  }

  async currentForStudent(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try { return reply.send({ data: await this.service.getCurrentForStudent(request.user.id) }); }
    catch (error) { return this.fail(reply, error, { route: 'batch-current', requestId: request.id }); }
  }

  async dashboardSummary(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try { return reply.send({ data: await this.service.getDashboardSummary(request.user.id) }); }
    catch (error) { return this.fail(reply, error, { route: 'dashboard-summary', requestId: request.id }); }
  }

  async answer(request: FastifyRequest<{ Params: { challengeId: string }; Body: unknown }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = answerChallengeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    try { return reply.send({ data: await this.service.answer(request.user.id, request.params.challengeId, parsed.data) }); }
    catch (error) { return this.fail(reply, error, { route: 'answer', requestId: request.id, challengeId: request.params.challengeId }); }
  }

  async ranking(request: FastifyRequest<{ Params: { monitorId: string }; Querystring: { month?: string; period?: 'week' | 'month' | 'all' } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const period = request.query.period ?? (request.query.month ? 'month' : 'month');
    let start: Date | undefined;
    let end: Date | undefined;

    if (period === 'all') {
      start = undefined;
      end = undefined;
    } else if (period === 'week') {
      const now = new Date();
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = undefined;
    } else {
      // period === 'month' (default)
      const month = request.query.month ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
      if (!rankingMonthSchema.safeParse(month).success) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'month deve estar no formato YYYY-MM.' });
      const [year, numericMonth] = month.split('-').map(Number);
      if (!year || !numericMonth || numericMonth < 1 || numericMonth > 12) return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'month inválido.' });
      start = new Date(Date.UTC(year, numericMonth - 1, 1, 3, 0, 0, 0));
      end = new Date(Date.UTC(year, numericMonth, 1, 3, 0, 0, 0));
    }

    try { return reply.send({ data: await this.service.getRanking(request.user.id, request.params.monitorId, start, end, period) }); }
    catch (error) { return this.fail(reply, error, { route: 'ranking', requestId: request.id, monitorId: request.params.monitorId, period }); }
  }
}
