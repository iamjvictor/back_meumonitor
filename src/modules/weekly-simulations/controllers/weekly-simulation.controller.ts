import type { FastifyReply, FastifyRequest } from 'fastify';
import { weeklySimulationAnswerSchema } from '../models/weekly-simulation.model.js';
import { WeeklySimulationAnswerService } from '../services/weekly-simulation-answer.service.js';
import { WeeklySimulationGenerationService } from '../services/weekly-simulation-generation.service.js';
import { WeeklySimulationRepository } from '../repositories/weekly-simulation.repository.js';
import { weeklySimulationSubmissionSchema } from '../models/weekly-simulation.model.js';
import { WeeklySimulationSubmissionService } from '../services/weekly-simulation-submission.service.js';

const errors: Record<string, number> = {
  STUDENT_NOT_FOUND: 404,
  MONITOR_NOT_ACCESSIBLE: 403,
  SIMULATION_NOT_FOUND: 404,
  SIMULATION_ITEM_NOT_FOUND: 404,
  SIMULATION_NOT_ANSWERABLE: 409,
  SIMULATION_NOT_STARTABLE: 409,
  SIMULATION_TIME_EXPIRED: 409,
  SIMULATION_ANSWERS_REQUIRED: 422,
  INVALID_SIMULATION_ANSWER: 422,
  SIMULATION_ALL_ANSWERS_REQUIRED: 422,
  SIMULATION_INVALID_ANSWERS: 422,
  INVALID_SELECTED_ANSWER: 422,
  INVALID_RESPONSE_TIME: 422,
};

export class WeeklySimulationController {
  constructor(
    private readonly generation: WeeklySimulationGenerationService,
    private readonly answer: WeeklySimulationAnswerService,
    private readonly repository: WeeklySimulationRepository,
    private readonly submission: WeeklySimulationSubmissionService,
  ) {}

  private fail(reply: FastifyReply, error: unknown) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return reply.code(errors[code] ?? 500).send({ error: errors[code] ? code : 'INTERNAL_SERVER_ERROR', message: 'Não foi possível processar o simulado.' });
  }

  async status(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try { console.info('[weekly-simulation]', { event: 'weekly_simulation.status_requested', requestId: request.id, userId: request.user.id, monitorId: request.params.monitorId }); return reply.send({ data: await this.generation.getStatus(request.user.id, request.params.monitorId) }); }
    catch (error) { return this.fail(reply, error); }
  }

  async generate(request: FastifyRequest<{ Params: { monitorId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try { console.info('[weekly-simulation]', { event: 'weekly_simulation.generation_http_started', requestId: request.id, userId: request.user.id, monitorId: request.params.monitorId }); return reply.code(202).send({ data: await this.generation.requestGeneration(request.user.id, request.params.monitorId) }); }
    catch (error) { console.error('[weekly-simulation]', { event: 'weekly_simulation.generation_http_failed', requestId: request.id, userId: request.user.id, monitorId: request.params.monitorId, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }); return this.fail(reply, error); }
  }

  async get(request: FastifyRequest<{ Params: { simulationId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      const simulation = await this.repository.findForUser(request.params.simulationId, request.user.id);
      if (!simulation) return reply.code(404).send({ error: 'SIMULATION_NOT_FOUND' });
      return reply.send({ data: this.serializeSimulation(simulation) });
    } catch (error) { return this.fail(reply, error); }
  }

  async start(request: FastifyRequest<{ Params: { simulationId: string } }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    try {
      const { studentId } = await this.repository.findStudentForUser(request.params.simulationId, request.user.id);
      const simulation = await this.repository.startForStudent({ simulationId: request.params.simulationId, studentId });
      console.info('[weekly-simulation]', { event: 'weekly_simulation.solving_started', requestId: request.id, userId: request.user.id, simulationId: simulation.id, solvingStartedAt: simulation.solvingStartedAt, deadlineAt: simulation.deadlineAt });
      return reply.send({ data: { solvingStartedAt: simulation.solvingStartedAt, deadlineAt: simulation.deadlineAt, timeLimitSeconds: simulation.timeLimitSeconds, status: simulation.status } });
    } catch (error) { return this.fail(reply, error); }
  }

  async answerItem(request: FastifyRequest<{ Params: { simulationId: string; itemId: string }; Body: unknown }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = weeklySimulationAnswerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    try { const result = await this.answer.answer(request.user.id, request.params.simulationId, request.params.itemId, parsed.data); console.info('[weekly-simulation]', { event: 'weekly_simulation.answer_http_completed', requestId: request.id, userId: request.user.id, simulationId: request.params.simulationId, itemId: request.params.itemId, alreadyAnswered: result.alreadyAnswered, isCorrect: result.isCorrect, durationSeconds: result.durationSeconds }); return reply.send({ data: result }); }
    catch (error) { return this.fail(reply, error); }
  }

  async submit(request: FastifyRequest<{ Params: { simulationId: string }; Body: unknown }>, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = weeklySimulationSubmissionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    try { return reply.send({ data: await this.submission.submit(request.user.id, request.params.simulationId, parsed.data.answers) }); }
    catch (error) { console.error('[weekly-simulation]', { event: 'weekly_simulation.submission_failed', requestId: request.id, userId: request.user.id, simulationId: request.params.simulationId, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR', error: error instanceof Error ? error.stack : String(error) }); return this.fail(reply, error); }
  }

  private serializeSimulation(simulation: Awaited<ReturnType<WeeklySimulationRepository['findForUser']>>) {
    if (!simulation) return null;
    return {
      id: simulation.id,
      monitorId: simulation.monitorId,
      cycleStartDate: simulation.cycleStartDate,
      status: simulation.status,
      solvingStartedAt: simulation.solvingStartedAt,
      deadlineAt: simulation.deadlineAt,
      timeLimitSeconds: simulation.timeLimitSeconds,
      completedAt: simulation.completedAt,
      durationSeconds: simulation.durationSeconds,
      questionCount: simulation.questionCount,
      answeredCount: simulation.answeredCount,
      correctCount: simulation.correctCount,
      scorePercent: simulation.scorePercent,
      items: simulation.items.map((item) => ({
        id: item.id,
        position: item.position,
        question: {
          id: item.question.id,
          text: item.question.text,
          alternatives: item.question.alternatives,
          kind: item.question.kind,
          difficulty: item.question.difficulty,
          explanation: item.question.explanation,
          correctAnswer: item.question.correctAnswer,
          subject: item.question.subject,
          topic: item.question.topic,
        },
        answered: Boolean(item.answeredAt),
        answer: item.answeredAt ? { selectedAnswer: item.selectedAnswer, isCorrect: item.isCorrect, answeredAt: item.answeredAt, responseTimeMs: item.responseTimeMs } : null,
      })),
    };
  }
}
