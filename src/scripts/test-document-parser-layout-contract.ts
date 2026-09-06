import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const backendRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaPath = resolve(backendRoot, 'prisma/schema.prisma');

const schema = await readFile(schemaPath, 'utf8');
const blockMatch = schema.match(/model DocumentBlockElement \{[\s\S]*?\n\}/);

assert.ok(blockMatch, 'Bloco DocumentBlockElement não encontrado no schema Prisma.');
assert.ok(
  !blockMatch[0].includes('monitorDocumentId'),
  'DocumentBlockElement ainda declara monitorDocumentId sem coluna correspondente na migration.',
);

console.log('document parser layout contract: OK');
