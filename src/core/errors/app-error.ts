export interface AppErrorOptions {
  code: string;
  statusCode: number;
  publicMessage: string;
  internalDetails?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly internalDetails?: unknown;

  constructor(options: AppErrorOptions) {
    // Mantém o código no Error.message para compatibilidade de logs/testes legados;
    // a mensagem pública continua exclusivamente em publicMessage.
    super(options.code, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.publicMessage = options.publicMessage;
    this.internalDetails = options.internalDetails;
  }
}
