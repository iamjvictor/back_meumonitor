import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedQuestionBankSelection } from '../question-bank-selection.service.js';
import {
  QuestionBankMaterializationService,
  type QuestionBankMaterializationRepository,
  type QuestionBankMaterializationItem,
} from '../question-bank-materialization.service.js';

const selection: NormalizedQuestionBankSelection = {
  subject: 'Matemática',
  topic: 'Álgebra',
  examType: 'ENEM',
  board: null,
  subtopic: null,
  subsubtopic: null,
  selectionKey: 'ENEM||MATEMÁTICA|ÁLGEBRA|||',
};

function item(overrides: Partial<QuestionBankMaterializationItem> = {}): QuestionBankMaterializationItem {
  return {
    id: 'item-1',
    provider: 'ENEMHUB',
    providerQuestionId: '123',
    externalId: 'ext-123',
    examType: 'ENEM',
    examName: 'ENEM 2024',
    board: null,
    institution: null,
    examYear: 2024,
    subject: 'Matemática',
    topic: 'Álgebra',
    subtopic: null,
    subsubtopic: null,
    taxonomyPath: ['Matemática', 'Álgebra'],
    statementHtml: '<p>Quanto é 2 + 2?</p>',
    statementText: 'Quanto é 2 + 2?',
    alternatives: [
      { providerId: null, label: 'A', text: '3', isCorrect: false },
      { providerId: null, label: 'B', text: '4', isCorrect: true },
    ],
    correctAnswer: 'B',
    difficulty: 'medio',
    sourceUrl: 'https://example.com/questions/123',
    imageUrls: ['https://example.com/image.png'],
    explanation: 'Somando os termos, obtemos 4.',
    status: 'IMPORTED',
    ...overrides,
  };
}

function repository(items: QuestionBankMaterializationItem[]) {
  const upserts: Array<Record<string, unknown>> = [];
  const repo: QuestionBankMaterializationRepository = {
    async findItems() { return items; },
    async findBySourceKey(sourceKey) {
      return upserts.find((value) => value.sourceKey === sourceKey)
        ? { id: 'question-1' }
        : null;
    },
    async upsertQuestion(data) {
      const existed = upserts.some((value) => value.sourceKey === data.sourceKey);
      upserts.push(data);
      return { id: existed ? 'question-1' : `question-${upserts.length}`, created: !existed };
    },
  };
  return { repo, upserts };
}

const input = {
  teacherId: 'teacher-1',
  monitorId: 'monitor-1',
  selections: [{ monitorTopicId: 'topic-1', monitorSubjectId: 'subject-1', selection }],
};

test('materializa uma questão válida com rastreabilidade e snapshot', async () => {
  const { repo, upserts } = repository([item()]);
  const result = await new QuestionBankMaterializationService(repo).materialize(input);

  assert.deepEqual(result, { processed: 1, created: 1, updated: 0, skipped: 0, failures: [] });
  assert.equal(upserts[0]?.questionBankItemId, 'item-1');
  assert.equal(upserts[0]?.sourceKey, 'question-bank:monitor-1:item-1');
  assert.equal(upserts[0]?.status, 'APPROVED');
  assert.equal(upserts[0]?.needsReview, false);
  assert.equal(upserts[0]?.topicId, 'topic-1');
  assert.equal(upserts[0]?.subjectId, 'subject-1');
  assert.deepEqual(upserts[0]?.alternatives, [{ label: 'A', text: '3' }, { label: 'B', text: '4' }]);
  assert.match(JSON.stringify(upserts[0]?.metadata), /subsubtopic/);
});

test('materializa questões sem subtopic quando a seleção local é Geral', async () => {
  const generalSelection: NormalizedQuestionBankSelection = {
    ...selection,
    subject: 'Matemática',
    topic: 'Análise de Tabelas e Gráficos',
    subtopic: 'Geral',
    selectionKey: 'ENEM||MATEMÁTICA|ANÁLISE DE TABELAS E GRÁFICOS|GERAL|',
  };
  const { repo, upserts } = repository([item({ topic: 'Análise de Tabelas e Gráficos', subtopic: null })]);
  const result = await new QuestionBankMaterializationService(repo).materialize({
    ...input,
    selections: [{ ...input.selections[0]!, selection: generalSelection }],
  });

  assert.equal(result.created, 1);
  assert.equal(upserts.length, 1);
});

test('não materializa item sem alternativas válidas ou com gabarito incompatível', async () => {
  const { repo, upserts } = repository([
    item({ id: 'no-alternatives', alternatives: [] }),
    item({ id: 'bad-answer', correctAnswer: 'C' }),
  ]);
  const result = await new QuestionBankMaterializationService(repo).materialize(input);

  assert.equal(result.processed, 2);
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 2);
  assert.equal(result.failures.length, 2);
  assert.equal(upserts.length, 0);
});

test('ignora item arquivado', async () => {
  const { repo, upserts } = repository([item({ status: 'ARCHIVED' })]);
  const result = await new QuestionBankMaterializationService(repo).materialize(input);

  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failures[0]?.reason, 'QUESTION_BANK_ITEM_NOT_ACTIVE');
  assert.equal(upserts.length, 0);
});

test('deduplica o mesmo item encontrado por duas seleções', async () => {
  const { repo, upserts } = repository([item()]);
  const result = await new QuestionBankMaterializationService(repo).materialize({
    ...input,
    selections: [
      ...input.selections,
      {
        monitorTopicId: 'topic-2',
        monitorSubjectId: 'subject-2',
        selection: { ...selection, subtopic: 'Equações', selectionKey: 'ENEM||MATEMÁTICA|ÁLGEBRA|EQUAÇÕES||' },
      },
    ],
  });

  assert.equal(result.processed, 1);
  assert.equal(result.created, 1);
  assert.equal(upserts.length, 1);
});

test('retry usa a mesma sourceKey e atualiza a cópia existente', async () => {
  const { repo, upserts } = repository([item()]);
  const service = new QuestionBankMaterializationService(repo);

  const first = await service.materialize(input);
  const second = await service.materialize(input);

  assert.equal(first.created, 1);
  assert.equal(second.updated, 1);
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0]?.sourceKey, upserts[1]?.sourceKey);
});

test('itens iguais podem ser materializados em monitores diferentes', async () => {
  const first = repository([item()]);
  const second = repository([item()]);

  const resultOne = await new QuestionBankMaterializationService(first.repo).materialize(input);
  const resultTwo = await new QuestionBankMaterializationService(second.repo).materialize({ ...input, monitorId: 'monitor-2' });

  assert.equal(resultOne.created, 1);
  assert.equal(resultTwo.created, 1);
  assert.notEqual(first.upserts[0]?.sourceKey, second.upserts[0]?.sourceKey);
});

test('falha de persistência de um item não aprova nem interrompe o lote', async () => {
  const valid = item();
  const repository: QuestionBankMaterializationRepository = {
    async findItems() { return [valid, item({ id: 'item-2', providerQuestionId: '124' })]; },
    async findBySourceKey(sourceKey) {
      if (sourceKey.endsWith('item-1')) throw new Error('database unavailable');
      return null;
    },
    async upsertQuestion(data) { return { id: data.questionBankItemId, created: true }; },
  };

  const result = await new QuestionBankMaterializationService(repository).materialize(input);

  assert.equal(result.processed, 2);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.match(result.failures[0]?.reason ?? '', /database unavailable/);
});

test('falha na consulta do acervo retorna resumo estruturado', async () => {
  const repository: QuestionBankMaterializationRepository = {
    async findItems() { throw new Error('question bank unavailable'); },
    async findBySourceKey() { return null; },
    async upsertQuestion(data) { return { id: data.questionBankItemId, created: true }; },
  };

  const result = await new QuestionBankMaterializationService(repository).materialize(input);

  assert.equal(result.processed, 0);
  assert.equal(result.created, 0);
  assert.match(result.failures[0]?.reason ?? '', /question bank unavailable/);
});
