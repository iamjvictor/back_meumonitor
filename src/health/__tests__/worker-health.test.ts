import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkerHealth, WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_TTL_SECONDS } from '../worker-health.js';

test('mantém heartbeat com intervalo e TTL compatíveis com polling reduzido', () => {
  assert.equal(WORKER_HEARTBEAT_INTERVAL_MS, 60_000);
  assert.equal(WORKER_HEARTBEAT_TTL_SECONDS, 180);
});

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
