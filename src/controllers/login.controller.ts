import type { FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema } from '../models/login.model.js';
import { LoginRepositoryError } from '../repositories/login.repository.js';
import { LoginService } from '../services/login.service.js';
import { AppError } from '../core/errors/app-error.js';

export class LoginController {
  constructor(private readonly service: LoginService) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now();
    console.log('Login recebido', {
      event: 'auth.login.request_received',
      requestId: request.id,
      method: request.method,
      url: request.url,
      receivedFields: request.body && typeof request.body === 'object' ? Object.keys(request.body) : [],
    });

    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      console.log('Login rejeitado na validacao', {
        event: 'auth.login.validation_failed',
        requestId: request.id,
        invalidFields: Object.keys(result.error.flatten().fieldErrors),
        durationMs: Date.now() - startedAt,
      });
      throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 400, publicMessage: 'E-mail ou senha invalidos.', internalDetails: result.error.flatten().fieldErrors });
    }

    try {
      const login = await this.service.execute(result.data);

      reply.setCookie('mm_access_token', login.session.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: login.session.expiresIn,
      });
      reply.setCookie('mm_refresh_token', login.session.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });

      console.log('Cookies de login emitidos', {
        event: 'auth.login.cookies_issued',
        requestId: request.id,
        userId: login.userId,
      });

      const { session: _session, ...publicLogin } = login;
      console.log('Login finalizado', {
        event: 'auth.login.completed',
        requestId: request.id,
        userId: login.userId,
        role: login.role,
        durationMs: Date.now() - startedAt,
      });
      return reply.code(200).send({ data: publicLogin });
    } catch (error) {
      if (error instanceof LoginRepositoryError) {
        const isEmailNotConfirmed =
          error.providerCode === 'email_not_confirmed' ||
          error.message.toLowerCase().includes('email not confirmed') ||
          error.message.toLowerCase().includes('email_not_confirmed');

        if (isEmailNotConfirmed) {
          console.log('Login bloqueado: email nao confirmado', {
            event: 'auth.login.email_not_confirmed',
            requestId: request.id,
            providerStatus: error.status,
            providerCode: error.providerCode,
            durationMs: Date.now() - startedAt,
          });
          throw new AppError({ code: 'EMAIL_NOT_CONFIRMED', statusCode: 403, publicMessage: 'Confirme seu e-mail antes de entrar na conta.' });
        }

        console.log('Login rejeitado pelo Auth', {
          event: 'auth.login.auth_rejected',
          requestId: request.id,
          durationMs: Date.now() - startedAt,
          providerStatus: error.status,
          providerCode: error.providerCode,
          providerError: error.providerCode ?? 'unknown',
        });
        throw new AppError({ code: 'INVALID_CREDENTIALS', statusCode: 401, publicMessage: 'E-mail ou senha invalidos.', cause: error });
      }

      console.log('Falha inesperada no login', {
        event: 'auth.login.failed',
        requestId: request.id,
        durationMs: Date.now() - startedAt,
      });
      throw new AppError({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500, publicMessage: 'Nao foi possivel realizar o login.', cause: error });
    }
  }
}
