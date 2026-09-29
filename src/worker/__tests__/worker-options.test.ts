import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKER_DRAIN_DELAY_SECONDS, WORKER_STALLED_INTERVAL_MS, createQueueWorkerOptions } from '../worker-options.js';

test('mantém workers ociosos por um minuto antes de consultar novamente', () => {
  const options = createQueueWorkerOptions('redis-connection', 2);

  assert.equal(WORKER_DRAIN_DELAY_SECONDS, 60);
  assert.equal(options.drainDelay, 60);
  assert.equal(options.concurrency, 2);
});

test('verifica jobs travados a cada cinco minutos', () => {
  assert.equal(WORKER_STALLED_INTERVAL_MS, 300_000);
  assert.equal(createQueueWorkerOptions('redis-connection', 1).stalledInterval, 300_000);
});
