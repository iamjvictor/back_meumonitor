import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import { logSafeError, type SafeErrorLogEntry } from './safe-error-logger.js';

type FastifyValidationError = Error & { validation?: unknown };

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
  return error instanceof Error && Array.isArray((error as FastifyValidationError).validation);
}

export function createErrorHandler(write: (entry: SafeErrorLogEntry) => void = (entry) => console.error(entry)) {
  return function errorHandler(error: unknown, request: Pick<FastifyRequest, 'id' | 'method' | 'url'>, reply: FastifyReply) {
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

    return reply.code(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Erro interno do servidor.', details: null },
    });
  };
}
