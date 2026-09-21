import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('schema declara simulados semanais, itens imutáveis e unicidade por ciclo', async () => {
  const schema = await readFile(new URL('../../../../../prisma/schema.prisma', import.meta.url), 'utf8');

  for (const model of ['WeeklySimulation', 'WeeklySimulationItem']) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  assert.match(schema, /@@unique\(\[studentId, monitorId, cycleStartDate\]\)/);
  assert.match(schema, /@@unique\(\[simulationId, questionId\]\)/);
  assert.match(schema, /@@unique\(\[simulationId, position\]\)/);
  assert.match(schema, /SIMULATED/);
  assert.match(schema, /solvingStartedAt\s+DateTime\?/);
  assert.match(schema, /deadlineAt\s+DateTime\?/);
  assert.match(schema, /timeLimitSeconds\s+Int\s+@default\(3600\)/);
  assert.match(schema, /durationSeconds\s+Int\?/);
  assert.match(schema, /responseTimeMs\s+Int\?/);
});
