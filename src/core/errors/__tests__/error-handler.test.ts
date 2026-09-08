import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { createErrorHandler } from '../error-handler.js';

function replySpy() {
  return {
    statusCode: 0,
    payload: undefined as unknown,
    code(value: number) { this.statusCode = value; return this; },
    send(value: unknown) { this.payload = value; return this; },
  };
}

test('responde AppError e registra somente metadados seguros', () => {
  const logs: unknown[] = [];
  const handler = createErrorHandler((entry) => logs.push(entry));
  const reply = replySpy();

  handler(
    new AppError({
      code: 'FORBIDDEN',
      statusCode: 403,
      publicMessage: 'Acesso negado.',
      internalDetails: { token: 'secret-token', password: 'secret-password' },
    }),
    { id: 'request-1', method: 'GET', url: '/private' },
    reply,
  );

  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, { error: { code: 'FORBIDDEN', message: 'Acesso negado.', details: null } });
  assert.equal(JSON.stringify(logs).includes('secret-token'), false);
  assert.equal(JSON.stringify(logs).includes('secret-password'), false);
});

test('converte erro inesperado e ZodError para contratos seguros', () => {
  const logs: unknown[] = [];
  const handler = createErrorHandler((entry) => logs.push(entry));
  const unexpectedReply = replySpy();
  const validationReply = replySpy();

  handler(new Error('database password secret'), { id: 'request-2', method: 'POST', url: '/x' }, unexpectedReply);
  handler(z.object({ email: z.string().email() }).safeParse({ email: 'invalid' }).error, { id: 'request-3', method: 'POST', url: '/x' }, validationReply);

  assert.equal(unexpectedReply.statusCode, 500);
  assert.deepEqual(unexpectedReply.payload, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Erro interno do servidor.', details: null } });
  assert.equal(validationReply.statusCode, 422);
  assert.deepEqual(validationReply.payload, { error: { code: 'VALIDATION_ERROR', message: 'Dados de entrada inválidos.', details: null } });
  assert.equal(JSON.stringify(logs).includes('database password secret'), false);
});

test('converte erro nativo de validação do Fastify sem expor detalhes', () => {
  const logs: unknown[] = [];
  const handler = createErrorHandler((entry) => logs.push(entry));
  const reply = replySpy();
  const error = Object.assign(new Error('body validation failed'), {
    validation: [{ keyword: 'required', params: { missingProperty: 'email' } }],
  });

  handler(error, { id: 'request-4', method: 'POST', url: '/users' }, reply);

  assert.equal(reply.statusCode, 422);
  assert.deepEqual(reply.payload, { error: { code: 'VALIDATION_ERROR', message: 'Dados de entrada inválidos.', details: null } });
  assert.equal(JSON.stringify(logs).includes('missingProperty'), false);
});
