import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedQuestionBankItemSchema } from '../question-bank.model.js';

const validItem = {
  provider: 'ENEMHUB' as const,
  providerQuestionId: 'question-1',
  externalId: '618326',
  examType: 'ENEM' as const,
  examName: 'ENEM',
  board: null,
  institution: null,
  examYear: 2023,
  subject: 'Matemática',
  topic: 'Álgebra > Logaritmo',
  subtopic: null,
  subsubtopic: null,
  taxonomyPath: ['Álgebra', 'Logaritmo'],
  statementHtml: '<p>Enunciado</p>',
  statementText: 'Enunciado',
  alternatives: [
    { providerId: 'alternative-1', label: 'A', text: 'Resposta', isCorrect: true },
    { providerId: 'alternative-2', label: 'B', text: 'Outra resposta', isCorrect: false },
  ],
  correctAnswer: 'A',
  difficulty: 'MEDIUM',
  sourceUrl: null,
  imageUrls: [],
  rawPayload: { id: 'question-1' },
  sourceFetchedAt: new Date('2026-09-11T12:00:00.000Z'),
};

test('aceita questão normalizada com subtopic nulo', () => {
  const result = normalizedQuestionBankItemSchema.safeParse(validItem);
  assert.equal(result.success, true);
});

test('rejeita questão sem subject', () => {
  const result = normalizedQuestionBankItemSchema.safeParse({ ...validItem, subject: '' });
  assert.equal(result.success, false);
});

test('rejeita questão sem topic', () => {
  const result = normalizedQuestionBankItemSchema.safeParse({ ...validItem, topic: '   ' });
  assert.equal(result.success, false);
});

test('rejeita quando correctAnswer não corresponde a uma alternativa correta', () => {
  const result = normalizedQuestionBankItemSchema.safeParse({
    ...validItem,
    correctAnswer: 'B',
  });
  assert.equal(result.success, false);
});

test('rejeita quando há mais de uma alternativa correta', () => {
  const result = normalizedQuestionBankItemSchema.safeParse({
    ...validItem,
    alternatives: validItem.alternatives.map((alternative) => ({ ...alternative, isCorrect: true })),
  });
  assert.equal(result.success, false);
});

test('aceita questão sem imagens e preserva payload JSON', () => {
  const result = normalizedQuestionBankItemSchema.safeParse(validItem);
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.imageUrls, []);
    assert.deepEqual(result.data.rawPayload, { id: 'question-1' });
  }
});

test('aceita a terceira camada opcional de detalhamento', () => {
  const result = normalizedQuestionBankItemSchema.safeParse({
    ...validItem,
    topic: 'Geometria',
    subtopic: 'Geometria Plana',
    subsubtopic: 'Áreas e Perímetros',
    taxonomyPath: ['Geometria', 'Geometria Plana', 'Áreas e Perímetros'],
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal((result.data as Record<string, unknown>).subsubtopic, 'Áreas e Perímetros');
  }
});
