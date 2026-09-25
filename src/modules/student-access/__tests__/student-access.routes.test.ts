import Fastify from 'fastify';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { studentAccessRoutes } from '../student-access.routes.js';

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

test('rota legada de cancelamento não pode alterar apenas projeções locais', async () => {
  let called = false;
  const app = Fastify();
  apps.push(app);
  await app.register(async (instance) => studentAccessRoutes(instance, {
    cancelMonitorAccess: async () => {
      called = true;
    },
  } as any));

  const response = await app.inject({
    method: 'POST',
    url: '/student/monitors/monitor-1/cancel',
  });

  assert.equal(response.statusCode, 410);
  assert.equal(called, false);
  assert.equal(response.json().code, 'LEGACY_CANCELLATION_DISABLED');
});
