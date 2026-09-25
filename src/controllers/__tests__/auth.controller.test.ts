import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from '../auth.controller.js';
import type { AuthService } from '../../services/auth.service.js';

test('o cadastro de aluno responde sem expor tokens de sessão', async () => {
  const service = {
    async signup() {
      return {
        userId: 'a2de6e63-b632-4f2f-a4b5-93547719ef41',
        email: 'aluno@example.com',
        role: 'student' as const,
        emailConfirmationRequired: false,
        session: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 3600,
        },
      };
    },
  } as unknown as AuthService;
  const controller = new AuthController(service);
  const cookies: Array<{ name: string; value: string }> = [];
  let statusCode: number | undefined;
  let responseBody: unknown;
  const reply = {
    setCookie(name: string, value: string) {
      cookies.push({ name, value });
      return this;
    },
    code(status: number) {
      statusCode = status;
      return this;
    },
    send(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as FastifyReply;

  await controller.signup({
    id: 'request-1',
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { 'content-type': 'application/json' },
    body: {
      email: 'aluno@example.com',
      password: 'Senha-teste-123',
      name: 'Aluno de teste',
      role: 'student',
    },
  } as unknown as FastifyRequest, reply);

  assert.equal(statusCode, 201);
  assert.deepEqual(responseBody, {
    data: {
      userId: 'a2de6e63-b632-4f2f-a4b5-93547719ef41',
      email: 'aluno@example.com',
      role: 'student',
      emailConfirmationRequired: false,
    },
  });
  assert.deepEqual(cookies.map((cookie) => cookie.name), ['mm_access_token', 'mm_refresh_token']);
});
