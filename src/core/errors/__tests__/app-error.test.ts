import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../app-error.js';
import { toPublicErrorResponse } from '../../http/error-response.js';

test('serializa AppError sem expor detalhes internos ou causa', () => {
  const error = new AppError({
    code: 'MONITOR_NOT_ACCESSIBLE',
    statusCode: 403,
    publicMessage: 'Acesso negado.',
    internalDetails: { userId: 'user-1', token: 'secret-token' },
    cause: new Error('query interna'),
  });

  assert.equal(error.statusCode, 403);
  assert.deepEqual(toPublicErrorResponse(error), {
    error: { code: 'MONITOR_NOT_ACCESSIBLE', message: 'Acesso negado.', details: null },
  });
  assert.equal(JSON.stringify(toPublicErrorResponse(error)).includes('secret-token'), false);
  assert.equal(JSON.stringify(toPublicErrorResponse(error)).includes('query interna'), false);
});

test('converte erro desconhecido para erro interno seguro', () => {
  const response = toPublicErrorResponse(new Error('senha=super-secreta'));

  assert.deepEqual(response, {
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Erro interno do servidor.', details: null },
  });
  assert.equal(JSON.stringify(response).includes('super-secreta'), false);
});
