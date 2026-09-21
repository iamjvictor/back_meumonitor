import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('consultas de desempenho aceitam janela temporal do ciclo semanal', async () => {
  const source = await readFile(new URL('../student-performance.repository.ts', import.meta.url), 'utf8');

  assert.match(source, /aggregateByScope\([^)]*window/);
  assert.match(source, /aggregateFlashcardByScope\([^)]*window/);
  assert.match(source, /answered_at >=/);
  assert.match(source, /answered_at <=/);
  assert.match(source, /reviewed_at >=/);
  assert.match(source, /reviewed_at <=/);
});

test('desempenho de simulados semanais usa itens respondidos e apenas simulações concluídas', async () => {
  const source = await readFile(new URL('../student-performance.repository.ts', import.meta.url), 'utf8');

  assert.match(source, /aggregateWeeklySimulationByScope/);
  assert.match(source, /FROM weekly_simulation_items AS items/);
  assert.match(source, /simulations\.status = 'COMPLETED'/);
  assert.match(source, /items\.answered_at IS NOT NULL/);
  assert.doesNotMatch(source, /weekly_simulation_items[\s\S]{0,500}student_question_attempts/);
});
