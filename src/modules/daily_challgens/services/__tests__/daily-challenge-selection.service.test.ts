import assert from 'node:assert/strict';
import test from 'node:test';
import { getSaoPauloChallengeWindow, selectRandomUnusedQuestion } from '../daily-challenge-selection.service.js';

test('selects one candidate using the supplied random source and returns null when empty', () => {
  assert.equal(selectRandomUnusedQuestion([], () => 0), null);
  assert.equal(selectRandomUnusedQuestion(['q1', 'q2', 'q3'], () => 0.5), 'q2');
});

test('calculates the local challenge date and end boundary in São Paulo', () => {
  const window = getSaoPauloChallengeWindow(new Date('2026-09-04T02:30:00.000Z'));
  assert.equal(window.challengeDate, '2026-09-03');
  assert.equal(window.availableFrom.toISOString(), '2026-09-03T03:00:00.000Z');
  assert.equal(window.availableUntil.toISOString(), '2026-09-04T02:59:59.999Z');
});
