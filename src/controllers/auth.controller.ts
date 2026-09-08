import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSignupLogData, getSignupRequestLogData, signupSchema } from '../models/auth.model.js';
import { AuthRepositoryError } from '../repositories/auth.repository.js';
import { AuthService } from '../services/auth.service.js';
import { AppError } from '../core/errors/app-error.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  async signup(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now();
    console.log('Signup recebido', {
      event: 'auth.signup.request_received',
      requestId: request.id,
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'],
      ...getSignupRequestLogData(request.body),
    });

    const result = signupSchema.safeParse(request.body);
    if (!result.success) {
      console.log('Signup rejeitado na validacao', {
        event: 'auth.signup.validation_failed',
        requestId: request.id,
        durationMs: Date.now() - startedAt,
        invalidFields: Object.keys(result.error.flatten().fieldErrors),
      });
      throw new AppError({ code: 'VALIDATION_ERROR', statusCode: 400, publicMessage: 'Dados basicos de cadastro invalidos.', internalDetails: result.error.flatten().fieldErrors });
    }

    console.log('Signup validado', { event: 'auth.signup.validation_succeeded', requestId: request.id, ...getSignupLogData(result.data) });

    try {
      const signup = await this.service.signup(result.data);

      if (signup.session) {
        reply.setCookie('mm_access_token', signup.session.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: signup.session.expiresIn,
        });
        reply.setCookie('mm_refresh_token', signup.session.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
        });
        console.log('Cookies de sessao emitidos', { event: 'auth.signup.cookies_issued', requestId: request.id, userId: signup.userId });
      }

      const { session: _session, ...publicSignup } = signup;
      console.log('Signup concluido', {
        event: 'auth.signup.completed',
        requestId: request.id,
        userId: signup.userId,
        role: signup.role,
        emailConfirmationRequired: signup.emailConfirmationRequired,
        sessionCreated: Boolean(signup.session),
        durationMs: Date.now() - startedAt,
      });
      return reply.code(201).send({ data: publicSignup });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        const isEmailProviderDisabled =
          error.message.toLowerCase().includes('email logins are disabled') ||
          error.message.toLowerCase().includes('email_provider_disabled');

        if (isEmailProviderDisabled) {
          console.log('Signup bloqueado: login por email desativado no Supabase', {
            event: 'auth.signup.email_provider_disabled',
            requestId: request.id,
            durationMs: Date.now() - startedAt,
          });
          throw new AppError({ code: 'EMAIL_PROVIDER_DISABLED', statusCode: 503, publicMessage: 'O login por e-mail esta desativado no provedor de autenticacao.' });
        }

        console.log('Signup rejeitado pelo Auth', { event: 'auth.signup.auth_rejected', requestId: request.id, durationMs: Date.now() - startedAt, providerError: 'AUTH_REPOSITORY_ERROR' });
        throw new AppError({ code: 'SIGNUP_UNAVAILABLE', statusCode: 409, publicMessage: 'Nao foi possivel criar a conta.', cause: error });
      }

      console.log('Falha inesperada no signup', { event: 'auth.signup.failed', requestId: request.id, durationMs: Date.now() - startedAt });
      throw new AppError({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500, publicMessage: 'Nao foi possivel criar a conta.', cause: error });
    }
  }
}
