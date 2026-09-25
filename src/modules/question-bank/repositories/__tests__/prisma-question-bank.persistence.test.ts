import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedQuestionBankItem } from '../../models/question-bank.model.js';
import { PrismaQuestionBankPersistence } from '../prisma-question-bank.persistence.js';

const item: NormalizedQuestionBankItem = {
  provider: 'QAPI',
  providerQuestionId: 'qapi-1',
  externalId: 'Q123',
  examType: 'CONCURSO',
  examName: 'Concurso Público',
  board: 'FGV',
  institution: null,
  examYear: 2024,
  subject: 'Conhecimento Específico',
  topic: 'Arquitetura de Computadores',
  subtopic: null,
  subsubtopic: null,
  taxonomyPath: ['Arquitetura de Computadores'],
  statementHtml: '<p>Enunciado</p>',
  statementText: 'Enunciado',
  alternatives: [{ providerId: null, label: 'A', text: 'Resposta', isCorrect: true }, { providerId: null, label: 'B', text: 'Outra', isCorrect: false }],
  correctAnswer: 'A',
  difficulty: null,
  sourceUrl: null,
  imageUrls: [],
  rawPayload: { id: 'qapi-1' },
  sourceFetchedAt: new Date('2026-09-11T12:00:00.000Z'),
};

test('persiste todos os campos normalizados e calcula hash estável', async () => {
  type UpsertArgs = { create: Record<string, unknown>; update: Record<string, unknown> };
  const received: { value: UpsertArgs | null } = { value: null };
  const persistence = new PrismaQuestionBankPersistence({
    findUnique: async () => null,
    upsert: async ({ create, update }: UpsertArgs) => {
      received.value = { create, update };
      return { id: 'bank-item-1', createdAt: new Date() };
    },
  } as never);

  const result = await persistence.upsert(item);

  assert.equal(result.id, 'bank-item-1');
  assert.equal(result.created, true);
  const persisted = received.value;
  if (!persisted) throw new Error('upsert não recebeu dados');
  assert.equal(persisted.create.provider, 'QAPI');
  assert.equal(persisted.create.subject, 'Conhecimento Específico');
  assert.equal(persisted.create.subtopic, null);
  assert.match(String(persisted.create.contentHash), /^[a-f0-9]{64}$/);
});
