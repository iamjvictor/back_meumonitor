import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(import.meta.dirname, '../../../../../');
const schema = fs.readFileSync(path.join(backendRoot, 'prisma/schema.prisma'), 'utf8');
const migrationDir = path.join(backendRoot, 'supabase/migrations');

test('declares question-bank traceability in Prisma', () => {
  assert.match(schema, /questionBankItemId\s+String\?\s+@map\("question_bank_item_id"\)\s+@db\.Uuid/);
  assert.match(schema, /questionBankItem\s+QuestionBankItem\?/);
  assert.match(schema, /questions\s+Question\[\]/);
  assert.match(schema, /examType\s+String\s+@map\("exam_type"\)/);
  assert.match(schema, /selectionKey\s+String\s+@map\("selection_key"\)/);
  assert.match(schema, /@@unique\(\[monitorId, questionBankItemId\]\)/);
  assert.match(schema, /@@unique\(\[monitorTopicId, selectionKey\]\)/);
});

test('declares local subtopic hierarchy in Prisma', () => {
  assert.match(schema, /model MonitorSubtopic/);
  assert.match(schema, /monitorTopicId\s+String\s+@map\("monitor_topic_id"\)/);
  assert.match(schema, /model MonitorSubsubtopic/);
  assert.match(schema, /monitorSubtopicId\s+String\s+@map\("monitor_subtopic_id"\)/);
  assert.match(schema, /subtopicId\s+String\?\s+@map\("subtopic_id"\)/);
  assert.match(schema, /subsubtopicId\s+String\?\s+@map\("subsubtopic_id"\)/);
});

test('contains an additive SQL migration for selection and question traceability', () => {
  const migrationName = fs.readdirSync(migrationDir).find((name) => name.endsWith('_question-bank-traceability.sql'));
  assert.ok(migrationName, 'expected question-bank-traceability migration');

  const migration = fs.readFileSync(path.join(migrationDir, migrationName), 'utf8');
  assert.match(migration, /ADD COLUMN "exam_type"/);
  assert.match(migration, /ADD COLUMN "selection_key"/);
  assert.match(migration, /ADD COLUMN "question_bank_item_id" UUID/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*ON "questions"\("monitor_id", "question_bank_item_id"\)/);
  assert.match(migration, /UNIQUE \("monitor_topic_id", "selection_key"\)/);
});
