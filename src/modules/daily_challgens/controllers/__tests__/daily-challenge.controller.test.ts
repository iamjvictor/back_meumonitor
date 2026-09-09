import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyChallengeController } from '../daily-challenge.controller.js';

function reply() {
  const state: { status?: number; body?: unknown } = {};
  const value = {
    state,
    code(status: number) { state.status = status; return this; },
    send(body: unknown) { state.body = body; return body; },
  };
  return { state, value: value as never };
}

test('ranking rejects impossible calendar months', async () => {
  const controller = new DailyChallengeController({} as never);
  const response = reply();

  await controller.ranking({ user: { id: 'user-1' }, query: { month: '2026-13' }, params: { monitorId: 'monitor-1' }, id: 'request-1' } as never, response.value);

  assert.equal(response.state.status, 422);
  assert.deepEqual(response.state.body, { error: 'VALIDATION_ERROR', message: 'month inválido.' });
});

test('ranking returns an empty list without fictional participants', async () => {
  const controller = new DailyChallengeController({
    getRanking: async () => ({ ranking: [], currentStudent: null }),
  } as never);
  const response = reply();

  await controller.ranking({ user: { id: 'user-1' }, query: { month: '2026-09' }, params: { monitorId: 'monitor-1' }, id: 'request-1' } as never, response.value);

  assert.deepEqual(response.state.body, { data: { ranking: [], currentStudent: null } });
});
