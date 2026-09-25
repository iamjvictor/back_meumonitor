import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LoginController } from '../login.controller.js';
import type { LoginService } from '../../services/login.service.js';

test('login retorna somente o accessToken para autenticação do frontend', async () => {
  const service = {
    async execute() {
      return {
        userId: 'b30b2b01-d90a-4ea4-8f0f-4024c2812fae',
        email: 'aluno@example.com',
        role: 'student',
        session: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 3600,
        },
      };
    },
  } as unknown as LoginService;
  const controller = new LoginController(service);
  let responseBody: unknown;
  const reply = {
    setCookie() {
      return this;
    },
    code() {
      return this;
    },
    send(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as FastifyReply;

  await controller.handle({
    id: 'request-login-1',
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'aluno@example.com', password: 'Senha-teste-123' },
  } as unknown as FastifyRequest, reply);

  assert.deepEqual(responseBody, {
    data: {
      userId: 'b30b2b01-d90a-4ea4-8f0f-4024c2812fae',
      email: 'aluno@example.com',
      role: 'student',
      accessToken: 'access-token',
    },
  });
  assert.equal(JSON.stringify(responseBody).includes('refresh-token'), false);
});
