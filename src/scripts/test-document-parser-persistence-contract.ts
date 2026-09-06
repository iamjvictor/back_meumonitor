import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(root, 'prisma/migrations/20260826090000_add_document_parser_artifacts/migration.sql'),
  'utf8',
);

const blockElementModel = schema.match(/model DocumentBlockElement \{([\s\S]*?)\n\}/)?.[1];
assert.ok(blockElementModel, 'DocumentBlockElement deve existir no Prisma schema.');

for (const field of ['blockId', 'layoutElementId', 'role', 'position', 'confidence']) {
  assert.match(blockElementModel, new RegExp(`^\\s*${field}\\s`, 'm'), `Campo ausente: ${field}`);
}

assert.doesNotMatch(
  blockElementModel,
  /^\s*monitorDocument(Id)?\s/m,
  'O schema não pode declarar relação monitorDocument sem coluna correspondente na migration da Fase 3.',
);

for (const column of ['block_id', 'layout_element_id', 'role', 'position', 'confidence']) {
  assert.match(migration, new RegExp(`\\"${column}\\"`), `Coluna ausente na migration: ${column}`);
}

assert.match(schema, /model DocumentVisualAsset \{[\s\S]*?\n\s*checksum\s+String\?/);
assert.match(migration, /"checksum"\s+TEXT/);

for (const table of [
  'document_parse_runs',
  'document_layout_elements',
  'document_visual_assets',
  'document_block_elements',
  'document_evidence_relations',
]) {
  assert.match(migration, new RegExp(`CREATE TABLE \\"${table}\\"`), `Tabela ausente: ${table}`);
  assert.match(migration, new RegExp(`ALTER TABLE \\"${table}\\" ENABLE ROW LEVEL SECURITY`));
}

assert.match(migration, /'document-parser-artifacts'[\s\S]*?false[\s\S]*?52428800/);
assert.match(migration, /'application\/json'/);
assert.match(migration, /'text\/html'/);
console.log('document parser persistence contract: OK');
