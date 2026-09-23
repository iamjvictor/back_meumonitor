import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateMonitorInput } from '../../models/monitor.model.js';
import type { MonitorRepository } from '../../repositories/monitor.repository.js';
import { MonitorService } from '../monitor.service.js';
import type { MaterializationResult } from '../../modules/question-bank/services/question-bank-materialization.service.js';
import type { QuestionBankMaterializationService } from '../../modules/question-bank/services/question-bank-materialization.service.js';

const input: CreateMonitorInput = {
  name: 'Monitor de Matemática',
  subjects: [{ name: 'Matemática', topics: [{ name: 'Álgebra > Equações' }] }],
};

function createdMonitor() {
  return {
    id: 'monitor-1',
    status: 'DRAFT',
    teacher: { id: 'teacher-1' },
    subjects: [{
      id: 'subject-1',
      name: 'Matemática',
      topics: [{
        id: 'topic-1',
        name: 'Álgebra > Equações',
        questionBankSelections: [{
          examType: 'ENEM',
          board: null,
          subtopic: 'Equações',
          subsubtopic: null,
        }],
      }],
    }],
  };
}

function repository(monitor = createdMonitor()) {
  return {
    async createDraft() { return { kind: 'CREATED' as const, monitor }; },
  } as unknown as MonitorRepository;
}

function materializer(result: MaterializationResult, received: { value?: unknown }) {
  return {
    async materialize(value: unknown) {
      received.value = value;
      return result;
    },
  } as unknown as QuestionBankMaterializationService;
}

test('criação somente própria não executa materialização', async () => {
  let called = false;
  const service = new MonitorService(
    repository({ ...createdMonitor(), subjects: [{ id: 'subject-1', name: 'Matemática', topics: [{ id: 'topic-1', name: 'Álgebra', questionBankSelections: [] }] }] }),
    { materialize: async () => { called = true; return { processed: 0, created: 0, updated: 0, skipped: 0, failures: [] }; } } as unknown as QuestionBankMaterializationService,
  );

  const result = await service.createDraft('user-1', input);

  assert.equal(called, false);
  assert.equal(result.kind, 'CREATED');
  assert.equal(result.materialization, null);
});

test('criação com seleção materializa usando IDs locais e mantém monitor DRAFT', async () => {
  const received: { value?: unknown } = {};
  const summary: MaterializationResult = { processed: 1, created: 1, updated: 0, skipped: 0, failures: [] };
  const service = new MonitorService(repository(), materializer(summary, received));

  const result = await service.createDraft('user-1', input);
  const materializationInput = received.value as {
    teacherId: string;
    monitorId: string;
    selections: Array<{ monitorTopicId: string; monitorSubjectId: string; selection: { topic: string; subtopic: string | null } }>;
  };

  assert.equal(result.kind, 'CREATED');
  assert.equal(result.monitor.status, 'DRAFT');
  assert.deepEqual(result.materialization, summary);
  assert.equal(materializationInput.teacherId, 'teacher-1');
  assert.equal(materializationInput.monitorId, 'monitor-1');
  assert.deepEqual(materializationInput.selections[0], {
    monitorTopicId: 'topic-1',
    monitorSubjectId: 'subject-1',
    monitorSubtopicId: null,
    monitorSubsubtopicId: null,
    selection: {
      subject: 'Matemática',
      topic: 'Álgebra',
      examType: 'ENEM',
      board: null,
      subtopic: 'Equações',
      subsubtopic: null,
      selectionKey: 'ENEM||MATEMÁTICA|ÁLGEBRA|EQUAÇÕES|',
    },
  });
});

test('falhas de itens retornam no resumo sem alterar o status DRAFT', async () => {
  const summary: MaterializationResult = {
    processed: 2,
    created: 1,
    updated: 0,
    skipped: 1,
    failures: [{ questionBankItemId: 'item-2', reason: 'QUESTION_BANK_ITEM_INVALID_ALTERNATIVES' }],
  };
  const service = new MonitorService(repository(), materializer(summary, {}));

  const result = await service.createDraft('user-1', input);

  assert.equal(result.kind, 'CREATED');
  assert.equal(result.monitor.status, 'DRAFT');
  assert.equal(result.materialization?.failures.length, 1);
});
