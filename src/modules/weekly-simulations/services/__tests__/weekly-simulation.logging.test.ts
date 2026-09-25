import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pipeline semanal mantém logs estruturados em todas as etapas críticas', async () => {
  const files = await Promise.all([
    readFile(new URL('../weekly-simulation-diagnostic.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../weekly-simulation-distribution.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../weekly-simulation-worker.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../weekly-simulation-generation.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../weekly-simulation-answer.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../controllers/weekly-simulation.controller.ts', import.meta.url), 'utf8'),
  ]);
  const source = files.join('\n');
  for (const event of [
    'weekly_simulation.generation_requested',
    'weekly_simulation.performance_data_loaded',
    'weekly_simulation.diagnostic_calculated',
    'weekly_simulation.question_distribution_calculated',
    'weekly_simulation.questions_selected',
    'weekly_simulation.persisted',
    'weekly_simulation.answer_recorded',
    'weekly_simulation.failed',
  ]) assert.match(source, new RegExp(event));
  assert.match(source, /performanceDataJson/);
});
