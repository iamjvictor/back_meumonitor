import type { FastifyReply, FastifyRequest } from 'fastify';
import { studentQuestionAttemptSchema } from '../models/student-question-attempt.model.js';
import { StudentQuestionAttemptService } from '../services/student-question-attempt.service.js';

const errors: Record<string, number> = {
  STUDENT_NOT_FOUND: 404,
  MONITOR_NOT_ACCESSIBLE: 403,
  QUESTION_NOT_ACCESSIBLE: 404,
};

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(event, { event, ...data });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const prismaError = error as Error & { code?: string; meta?: unknown; clientVersion?: string };
    return { errorName: error.name, errorMessage: error.message, errorCode: prismaError.code ?? null, errorMeta: prismaError.meta ?? null, stack: error.stack ?? null };
  }
  return { errorName: typeof error, errorMessage: String(error), errorCode: null, errorMeta: null, stack: null };
}

export class StudentQuestionAttemptController {
  constructor(private readonly service = new StudentQuestionAttemptService()) {}

  private fail(reply: FastifyReply, error: unknown, requestId?: string) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const statusCode = errors[code] ?? 500;
    log('monitor.student_question_attempt_http_failed', { requestId: requestId ?? null, ...errorDetails(error), domainErrorCode: errors[code] ? code : null, statusCode });
    return reply.code(statusCode).send({ error: errors[code] ? code : 'INTERNAL_SERVER_ERROR', message: 'Não foi possível registrar a resposta.', requestId: requestId ?? null });
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const query = request.query as { monitorId?: string; subjectId?: string; topicId?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
    log('monitor.student_questions_http_list_started', { requestId: request.id, userId: request.user.id, monitorId: query.monitorId ?? null, subjectId: query.subjectId ?? null, topicId: query.topicId ?? null, page, pageSize });
    try {
      const result = await this.service.listQuestions(request.user.id, { monitorId: query.monitorId, subjectId: query.subjectId, topicId: query.topicId, page, pageSize });
      log('monitor.student_questions_http_list_completed', { requestId: request.id, userId: request.user.id, count: result.questions.length, total: result.total, page, pageSize });
      return reply.send({ data: { ...result, page, pageSize } });
    } catch (error) {
      return this.fail(reply, error, request.id);
    }
  }

  async answer(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    log('monitor.student_question_attempt_http_started', {
      requestId: request.id,
      userId: request.user.id,
      questionId: (request.body as { questionId?: string } | undefined)?.questionId ?? null,
      mode: (request.body as { mode?: string } | undefined)?.mode ?? null,
      hasSelectedAnswer: Boolean((request.body as { selectedAnswer?: string } | undefined)?.selectedAnswer),
      hasIdempotencyKey: Boolean((request.body as { idempotencyKey?: string } | undefined)?.idempotencyKey),
    });
    const parsed = studentQuestionAttemptSchema.safeParse(request.body);
    if (!parsed.success) {
      log('monitor.student_question_attempt_validation_failed', { requestId: request.id, userId: request.user.id, issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })) });
      return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }
    try {
      const result = await this.service.answer(request.user.id, parsed.data);
      log('monitor.student_question_attempt_http_completed', { requestId: request.id, userId: request.user.id, questionId: parsed.data.questionId, questionAttemptId: result.attempt.id, mode: parsed.data.mode, isCorrect: result.isCorrect, idempotent: Boolean(parsed.data.idempotencyKey) });
      return reply.send({ data: {
        questionAttemptId: result.attempt.id,
        isCorrect: result.isCorrect,
        correctAnswer: result.correctAnswer,
        explanation: result.explanation,
      } });
    } catch (error) {
      return this.fail(reply, error, request.id);
    }
  }
}
