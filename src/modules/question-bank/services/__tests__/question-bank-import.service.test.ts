import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedQuestionBankItem } from '../../models/question-bank.model.js';
import { QuestionBankRepository } from '../../repositories/question-bank.repository.js';
import { importQuestionBankPages } from '../question-bank-import.service.js';

const item = {
  provider: 'ENEMHUB', providerQuestionId: '1', externalId: null, examType: 'ENEM', examName: 'ENEM',
  board: null, institution: null, examYear: 2023, subject: 'Matemática', topic: 'Álgebra',
  subtopic: null, subsubtopic: null, taxonomyPath: ['Álgebra'], statementHtml: '<p>x</p>', statementText: 'x',
  alternatives: [{ providerId: null, label: 'A', text: 'x', isCorrect: true }, { providerId: null, label: 'B', text: 'y', isCorrect: false }],
  correctAnswer: 'A', difficulty: 'EASY', sourceUrl: null, imageUrls: [], rawPayload: {}, sourceFetchedAt: new Date(),
} satisfies NormalizedQuestionBankItem;

test('importa páginas até o fim e contabiliza criação/atualização', async () => {
  let pageCalls = 0;
  const adapter = {
    fetchPage: async ({ page }: { page: number }) => {
      pageCalls += 1;
      return { items: page === 1 ? [item] : [], page, pageSize: 1, total: 1, hasNextPage: page === 1 };
    },
  };
  const persistence = {
    upsert: async () => ({ id: 'db-1', created: pageCalls === 1 }),
    findByProviderQuestionId: async () => null,
    countByProvider: async () => 1,
    listImportFailures: async () => [],
  };

  const result = await importQuestionBankPages({ adapter, repository: new QuestionBankRepository(persistence) });

  assert.equal(pageCalls, 2);
  assert.deepEqual(result, { pagesProcessed: 2, itemsReceived: 1, itemsCreated: 1, itemsUpdated: 0, itemsRejected: 0, lastPage: 2 });
});
