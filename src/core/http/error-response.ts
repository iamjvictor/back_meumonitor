import { AppError } from '../errors/app-error.js';

export interface PublicErrorResponse {
  error: {
    code: string;
    message: string;
    details: null;
  };
}

export function toPublicErrorResponse(error: unknown): PublicErrorResponse {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.publicMessage,
        details: null,
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Erro interno do servidor.',
      details: null,
    },
  };
}
