import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import { logSafeError, type SafeErrorLogEntry } from './safe-error-logger.js';

type FastifyValidationError = Error & { validation?: unknown };
type ErrorReply = { code(statusCode: number): ErrorReply; send(payload: unknown): unknown };

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
  return error instanceof Error && Array.isArray((error as FastifyValidationError).validation);
}

const legacyStatusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, STUDENT_NOT_FOUND: 404, PURCHASE_NOT_FOUND: 404,
  MONITOR_NOT_FOUND: 404, SUBSCRIPTION_NOT_FOUND: 404, VALIDATION_ERROR: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422, INVALID_CHECKOUT_SESSION: 422, SESSION_EXPIRED: 422,
  IDEMPOTENCY_KEY_REUSED: 409, ACTIVE_SUBSCRIPTION: 409, PURCHASE_NOT_PENDING: 409,
  PURCHASE_ALREADY_PAID: 409, AMOUNT_MISMATCH: 409, CURRENCY_MISMATCH: 409,
};

export function createErrorHandler(write: (entry: SafeErrorLogEntry) => void = (entry) => console.error(entry)) {
  return function errorHandler(error: unknown, request: Pick<FastifyRequest, 'id' | 'method' | 'url'>, reply: ErrorReply) {
    logSafeError(write, error, { requestId: request.id, method: request.method, url: request.url });

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.publicMessage, details: null },
      });
    }

    if (error instanceof ZodError || isFastifyValidationError(error)) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'Dados de entrada inválidos.', details: null },
      });
    }

    if (error instanceof Error && legacyStatusByCode[error.message]) {
      const code = error.message;
      const statusCode = legacyStatusByCode[code]!;
      return reply.code(statusCode).send({
        error: { code, message: 'Não foi possível processar a solicitação.', details: null },
      });
    }

    return reply.code(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Erro interno do servidor.', details: null },
    });
  };
}
