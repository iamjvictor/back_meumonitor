import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { PrismaFlashcardEvidenceProvider } from '../prisma-flashcard-evidence.provider.js';

function makeFlashcard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flashcard-1',
    front: 'O que é aceleração?',
    back: 'É a variação da velocidade no tempo.',
    kind: 'DEFINITION',
    status: 'APPROVED',
    topicId: 'topic-1',
    sources: [{
      chunkId: 'chunk-1',
      chunk: {
        id: 'chunk-1',
        documentId: 'document-1',
        blockId: 'block-1',
        content: 'A aceleração mede a variação da velocidade no tempo.',
        status: 'READY',
        pageStart: 3,
        pageEnd: 3,
      },
    }],
    ...overrides,
  };
}

test('carrega flashcard aprovado e suas fontes diretamente sem depender de embedding', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    flashcard: {
      async findFirst(input: Record<string, unknown>) {
        calls.push(input);
        return makeFlashcard();
      },
    },
  } as unknown as PrismaClient;
  const provider = new PrismaFlashcardEvidenceProvider(client);

  const result = await provider.get({
    flashcardId: 'flashcard-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.where, {
    id: 'flashcard-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    status: 'APPROVED',
  });
  assert.ok(result);
  assert.equal(result.sufficient, true);
  assert.equal(result.flashcardId, 'flashcard-1');
  assert.equal(result.front, 'O que é aceleração?');
  assert.equal(result.back, 'É a variação da velocidade no tempo.');
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.chunkId, 'chunk-1');
  assert.match(result.context, /O que é aceleração/);
  assert.match(result.context, /variação da velocidade/);
});

test('não retorna flashcard pendente ou fora do escopo', async () => {
  const client = {
    flashcard: { async findFirst() { return null; } },
  } as unknown as PrismaClient;
  const provider = new PrismaFlashcardEvidenceProvider(client);

  assert.equal(await provider.get({
    flashcardId: 'flashcard-pending',
    teacherId: 'teacher-1',
    monitorId: 'monitor-outro',
    subjectId: 'subject-outro',
  }), null);
});

test('considera suficiente o verso de um flashcard aprovado mesmo sem fonte documental', async () => {
  const client = {
    flashcard: {
      async findFirst() {
        return makeFlashcard({ sources: [] });
      },
    },
  } as unknown as PrismaClient;
  const provider = new PrismaFlashcardEvidenceProvider(client);

  const result = await provider.get({
    flashcardId: 'flashcard-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.ok(result);
  assert.equal(result.sufficient, true);
  assert.equal(result.citations.length, 0);
  assert.match(result.context, /É a variação da velocidade/);
});

test('ignora fontes de chunks que ainda não estão prontos', async () => {
  const client = {
    flashcard: {
      async findFirst() {
        return makeFlashcard({
          sources: [{
            chunkId: 'chunk-pending',
            chunk: {
              id: 'chunk-pending',
              documentId: 'document-1',
              blockId: 'block-1',
              content: 'Fonte pendente',
              status: 'EMBEDDING_PENDING',
              pageStart: null,
              pageEnd: null,
            },
          }],
        });
      },
    },
  } as unknown as PrismaClient;
  const provider = new PrismaFlashcardEvidenceProvider(client);

  const result = await provider.get({
    flashcardId: 'flashcard-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.ok(result);
  assert.equal(result.citations.length, 0);
  assert.equal(result.sufficient, true);
});
