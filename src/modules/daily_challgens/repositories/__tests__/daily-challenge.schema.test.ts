import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('schema declares daily challenge and student attempt invariants', async () => {
  const schema = await readFile(new URL('../../../../../prisma/schema.prisma', import.meta.url), 'utf8');
  for (const model of ['DailyChallenge', 'StudentQuestionAttempt', 'DailyChallengeAttempt']) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(schema, /@@unique\(\[monitorId, challengeDate\]\)/);
  assert.match(schema, /@@unique\(\[monitorId, questionId\]\)/);
  assert.match(schema, /@@unique\(\[dailyChallengeId, studentId\]\)/);
  assert.match(schema, /DAILY_CHALLENGE/);
});
