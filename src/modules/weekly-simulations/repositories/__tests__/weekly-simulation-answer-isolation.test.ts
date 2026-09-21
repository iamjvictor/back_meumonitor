import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('persiste respostas e tempo no item do simulado, sem criar student question attempt', async () => {
  const source = await readFile(new URL('../weekly-simulation.repository.ts', import.meta.url), 'utf8');

  assert.match(source, /weeklySimulationItem\.update/);
  assert.match(source, /responseTimeMs/);
  assert.doesNotMatch(source, /studentQuestionAttempt\.create/);
  assert.doesNotMatch(source, /questionAttemptId/);
});
