import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkerHealth } from '../worker-health.js';

test('considera o worker saudável quando o heartbeat existe no Redis', async () => {
  const health = await getWorkerHealth({
    async get() { return 'worker-123'; },
  });

  assert.deepEqual(health, { ready: true });
});

test('considera o worker indisponível quando o heartbeat não existe', async () => {
  const health = await getWorkerHealth({
    async get() { return null; },
  });

  assert.deepEqual(health, { ready: false });
});
