import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const backendRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const migrationPath = resolve(
  backendRoot,
  'prisma/migrations/20260826090000_add_document_parser_artifacts/migration.sql',
);

const migration = await readFile(migrationPath, 'utf8');

assert.ok(
  migration.includes("'application/json'"),
  'Bucket document-parser-artifacts não aceita application/json, apesar do repositório subir manifestos JSON.',
);

assert.ok(
  /'document-parser-artifacts'[\s\S]*?false[\s\S]*?52428800/.test(migration),
  'Bucket document-parser-artifacts deve ser privado e ter limite de 50 MB.',
);

console.log('document parser storage contract: OK');
