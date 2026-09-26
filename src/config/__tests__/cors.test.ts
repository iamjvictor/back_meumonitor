import assert from 'node:assert/strict';
import test from 'node:test';
import { corsAllowedHeaders, corsOrigins, env, isCorsOriginAllowed } from '../env.js';

test('inclui a origem pública do frontend nas origens CORS permitidas', () => {
  assert.ok(env.PUBLIC_FRONT_URL);

  const publicFrontOrigin = env.PUBLIC_FRONT_URL!.replace(/\/+$/, '');
  assert.ok(corsOrigins.includes(publicFrontOrigin));
});

test('permite o domínio público com e sem www', () => {
  assert.equal(isCorsOriginAllowed('https://meumonitoria.com.br'), true);
  assert.equal(isCorsOriginAllowed('https://www.meumonitoria.com.br'), true);
});

test('CORS permite o cabeçalho de bypass do aviso do ngrok', () => {
  assert.ok(corsAllowedHeaders.includes('ngrok-skip-browser-warning'));
});

test('não libera uma origem pública não configurada só porque está em desenvolvimento', () => {
  assert.equal(isCorsOriginAllowed('https://random-123.ngrok-free.app'), false);
});

test('mantém localhost permitido para desenvolvimento local', () => {
  assert.equal(isCorsOriginAllowed('http://localhost:3000'), true);
});
