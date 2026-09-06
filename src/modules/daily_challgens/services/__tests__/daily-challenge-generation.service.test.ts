import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyChallengeGenerationService } from '../daily-challenge-generation.service.js';

test('generates one random unused approved challenge per published monitor', async () => {
  const created: Array<Record<string, unknown>> = [];
  const repository = {
    findEligibleMonitors: async () => [{ id: 'monitor-1' }, { id: 'monitor-2' }],
    findByMonitorAndDate: async (monitorId: string) => monitorId === 'monitor-2' ? { id: 'existing' } : null,
    findApprovedUnusedQuestions: async () => [{ id: 'question-1' }, { id: 'question-2' }],
    createChallenge: async (data: Record<string, unknown>) => { created.push(data); return { id: 'challenge-1' }; },
  };
  const result = await new DailyChallengeGenerationService(repository as never).generateForDate(new Date('2026-09-03T12:00:00.000Z'));
  assert.equal(result.created, 1);
  assert.equal(result.existing, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.selectionStrategy, 'RANDOM_UNUSED_APPROVED');
});

test('does not create a challenge when a monitor has no unused approved questions', async () => {
  let createCalls = 0;
  const repository = {
    findEligibleMonitors: async () => [{ id: 'monitor-1' }],
    findByMonitorAndDate: async () => null,
    findApprovedUnusedQuestions: async () => [],
    createChallenge: async () => { createCalls += 1; return { id: 'never' }; },
  };
  const result = await new DailyChallengeGenerationService(repository as never).generateForDate(new Date('2026-09-03T12:00:00.000Z'));
  assert.equal(result.unavailable, 1);
  assert.equal(createCalls, 0);
});
