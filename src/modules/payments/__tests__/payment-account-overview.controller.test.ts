import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentAccountController } from '../http/payment-account.controller.js';
import { PaymentAccountNotFoundError, PaymentAccountOverviewProviderError } from '../application/queries/get-payment-account-overview.use-case.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { paymentAccountRoutes } from '../http/payment-account.routes.js';
import { createErrorHandler } from '../../../core/errors/error-handler.js';

test('overview rejeita aluno autenticado com 403', async () => {
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => ({}) } as never);
  await assert.rejects(() => controller.overview({ user: { id: 'student-1', role: 'student' } } as never, {} as never), (error: any) => error.code === 'FORBIDDEN' && error.statusCode === 403);
});

test('overview rejeita sessão ausente com 401', async () => {
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => ({}) } as never);
  await assert.rejects(() => controller.overview({ user: null } as never, {} as never), (error: any) => error.code === 'UNAUTHENTICATED' && error.statusCode === 401);
});

test('overview traduz conta inexistente para 404', async () => {
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => { throw new PaymentAccountNotFoundError(); } } as never);
  await assert.rejects(() => controller.overview({ id: 'r1', user: { id: 'teacher-1', role: 'teacher' } } as never, {} as never), (error: any) => error.statusCode === 404);
});

test('overview retorna 200 com métricas sem expor credencial', async () => {
  const data = { account: { id: 'a1', providerAccountId: 'asaas-1', walletId: 'w1', status: 'APPROVED', generalStatus: 'APPROVED', onboardingUrl: null, dashboardUrl: 'https://www.asaas.com/login' }, metrics: { availableBalanceCents: 100, receivedThisMonthCents: 200, pendingReceivablesCents: 50, pendingTransfersCount: 1, currency: 'BRL', asOf: '2026-09-25T00:00:00.000Z' } };
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => data } as never);
  const reply = { send(value: unknown) { assert.deepEqual(value, { data }); return value; } };
  await controller.overview({ id: 'r1', user: { id: 'teacher-1', role: 'professor' } } as never, reply as never);
});

test('overview retorna 200 com metrics null', async () => {
  const data = { account: { id: 'a1', providerAccountId: 'asaas-1', walletId: null, status: 'PENDING', generalStatus: null, onboardingUrl: null, dashboardUrl: null }, metrics: null };
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => data } as never);
  const reply = { send(value: unknown) { assert.deepEqual(value, { data }); return value; } };
  await controller.overview({ id: 'r1', user: { id: 'teacher-1', role: 'teacher' } } as never, reply as never);
});

test('overview normaliza erro de contrato não classificado para 502 sem corpo do provedor', async () => {
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => { throw new PaymentAccountOverviewProviderError('provider secret body: sk_test_supersecret'); } } as never);
  await assert.rejects(() => controller.overview({ id: 'r1', user: { id: 'teacher-1', role: 'teacher' } } as never, {} as never), (error: any) => error.code === 'PAYMENT_ACCOUNT_OVERVIEW_UNAVAILABLE' && error.statusCode === 502 && !String(error.publicMessage).includes('sk_test'));
});

test('overview deixa bug inesperado seguir para 500', async () => {
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => { throw new Error('database bug'); } } as never);
  await assert.rejects(() => controller.overview({ id: 'r1', user: { id: 'teacher-1', role: 'teacher' } } as never, {} as never), (error: any) => error.message === 'database bug');
});

test('rota HTTP real protege o path do overview com auth middleware', async () => {
  const app = Fastify();
  await app.register(cookie);
  app.setErrorHandler(createErrorHandler(() => {}));
  const data = { account: { id: 'a1', providerAccountId: 'asaas-1', walletId: null, status: 'PENDING', generalStatus: null, onboardingUrl: null, dashboardUrl: null }, metrics: null };
  const controller = new PaymentAccountController({} as never, {} as never, { execute: async () => data } as never);
  await app.register(async (instance) => paymentAccountRoutes(instance, controller), { prefix: '/api/v1' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/teachers/me/payment-account/overview' });
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /Sessao|Sessão/);
  await app.close();
});
