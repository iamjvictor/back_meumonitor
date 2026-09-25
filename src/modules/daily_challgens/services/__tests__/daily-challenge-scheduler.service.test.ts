import assert from 'node:assert/strict';
import test from 'node:test';
import { startDailyChallengeScheduler } from '../daily-challenge-scheduler.service.js';

test('scheduler gera imediatamente ao iniciar e agenda a próxima meia-noite', async () => {
  const calls: Array<{ callback: () => void; delay: number }> = [];
  let generated = 0;
  const scheduler = startDailyChallengeScheduler(
    async () => { generated += 1; },
    ((callback: () => void, delay: number) => { calls.push({ callback, delay }); return calls.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(generated, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.delay > 0);
  scheduler.stop();
});

test('scheduler agenda retry de cinco minutos quando a geração falha', async () => {
  const calls: Array<{ callback: () => void; delay: number }> = [];
  let attempts = 0;
  const scheduler = startDailyChallengeScheduler(
    async () => { attempts += 1; throw new Error('database timeout'); },
    ((callback: () => void, delay: number) => { calls.push({ callback, delay }); return calls.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.delay, 5 * 60 * 1000);
  scheduler.stop();
});
