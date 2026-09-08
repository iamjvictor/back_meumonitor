import { AppError } from './app-error.js';

export interface SafeErrorLogEntry {
  event: 'http.error';
  requestId: string;
  method: string;
  url: string;
  code: string;
  statusCode: number;
}

export function logSafeError(
  write: (entry: SafeErrorLogEntry) => void,
  error: unknown,
  context: { requestId: string; method: string; url: string },
) {
  const isAppError = error instanceof AppError;
  write({
    event: 'http.error',
    requestId: context.requestId,
    method: context.method,
    url: context.url,
    code: isAppError ? error.code : 'INTERNAL_SERVER_ERROR',
    statusCode: isAppError ? error.statusCode : 500,
  });
}
