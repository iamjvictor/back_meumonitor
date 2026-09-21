import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('migration cria tabelas, enums, FKs e constraints do simulado semanal', async () => {
  const migration = await readFile(new URL('../../../../../prisma/migrations/20260909170000_add_weekly_simulations/migration.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TYPE "WeeklySimulationStatus"/);
  assert.match(migration, /CREATE TYPE "WeeklySelectionPriority"/);
  assert.match(migration, /CREATE TABLE "weekly_simulations"/);
  assert.match(migration, /CREATE TABLE "weekly_simulation_items"/);
  assert.match(migration, /weekly_simulations_student_id_monitor_id_cycle_start_date_key/);
  assert.match(migration, /weekly_simulation_items_simulation_id_question_id_key/);
  assert.match(migration, /weekly_simulation_items_simulation_id_position_key/);
  assert.match(migration, /weekly_simulation_items_question_attempt_id_fkey/);
});
