import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../../../../', import.meta.url);

async function read(relativePath: string) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('questões e flashcards possuem status REPORTED', async () => {
  const schema = await read('prisma/schema.prisma');
  const migration = await read('prisma/migrations/20260910000100_add_reported_content_status/migration.sql');

  assert.match(schema, /enum QuestionStatus \{[\s\S]*?REPORTED[\s\S]*?\}/);
  assert.match(schema, /enum FlashcardStatus \{[\s\S]*?REPORTED[\s\S]*?\}/);
  assert.match(migration, /ALTER TYPE "QuestionStatus" ADD VALUE 'REPORTED'/);
  assert.match(migration, /ALTER TYPE "FlashcardStatus" ADD VALUE 'REPORTED'/);
});

test('criação de report altera conteúdo e report na mesma transação', async () => {
  const repository = await read('src/modules/student-content-report/repositories/student-content-report.repository.ts');

  assert.match(repository, /prisma\.\$transaction/);
  assert.match(repository, /studentContentReport\.create/);
  assert.match(repository, /question\.update/);
  assert.match(repository, /flashcard\.update/);
  assert.match(repository, /status:\s*'REPORTED'/);
});

test('consultas de flashcards dos alunos retornam somente conteúdo aprovado', async () => {
  const repository = await read('src/modules/student-flashcards/student-flashcards.repository.ts');

  assert.equal((repository.match(/status:\s*'APPROVED'/g) ?? []).length, 4);
});
