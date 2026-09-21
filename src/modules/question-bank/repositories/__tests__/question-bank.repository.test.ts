import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedQuestionBankItem } from '../../models/question-bank.model.js';
import { QuestionBankRepository, type QuestionBankPersistencePort } from '../question-bank.repository.js';

const item: NormalizedQuestionBankItem = {
  provider: 'ENEMHUB',
  providerQuestionId: 'question-1',
  externalId: '618326',
  examType: 'ENEM',
  examName: 'ENEM',
  board: null,
  institution: null,
  examYear: 2023,
  subject: 'Química',
  topic: 'Química Geral > Estequiometria',
  subtopic: null,
  subsubtopic: null,
  taxonomyPath: ['Química Geral', 'Estequiometria'],
  statementHtml: '<p>Enunciado</p>',
  statementText: 'Enunciado',
  alternatives: [{ providerId: null, label: 'A', text: 'Resposta', isCorrect: true }, { providerId: null, label: 'B', text: 'Outra', isCorrect: false }],
  correctAnswer: 'A',
  difficulty: 'MEDIUM',
  sourceUrl: null,
  imageUrls: [],
  rawPayload: { id: 'question-1' },
  sourceFetchedAt: new Date('2026-09-11T12:00:00.000Z'),
};

test('upsertNormalized delega a questão normalizada para a persistência', async () => {
  let received: NormalizedQuestionBankItem | null = null;
  const persistence: QuestionBankPersistencePort = {
    upsert: async (value) => {
      received = value;
      return { id: 'bank-item-1', created: true };
    },
    findByProviderQuestionId: async () => null,
    countByProvider: async () => 1,
    listImportFailures: async () => [],
  };

  const result = await new QuestionBankRepository(persistence).upsertNormalized(item);

  assert.deepEqual(received, item);
  assert.deepEqual(result, { id: 'bank-item-1', created: true });
});

test('os métodos de consulta preservam o provider e o identificador externo', async () => {
  const calls: Array<unknown[]> = [];
  const persistence: QuestionBankPersistencePort = {
    upsert: async () => ({ id: 'bank-item-1', created: false }),
    findByProviderQuestionId: async (...args) => { calls.push(args); return { id: 'bank-item-1' }; },
    countByProvider: async (...args) => { calls.push(args); return 4; },
    listImportFailures: async (...args) => { calls.push(args); return [{ id: 'bank-item-2' }]; },
  };
  const repository = new QuestionBankRepository(persistence);

  assert.deepEqual(await repository.findByProviderQuestionId('QAPI', 'q-1'), { id: 'bank-item-1' });
  assert.equal(await repository.countByProvider('ENEMHUB'), 4);
  assert.deepEqual(await repository.listImportFailures('QAPI', 10), [{ id: 'bank-item-2' }]);
  assert.deepEqual(calls, [['QAPI', 'q-1'], ['ENEMHUB'], ['QAPI', 10]]);
});
