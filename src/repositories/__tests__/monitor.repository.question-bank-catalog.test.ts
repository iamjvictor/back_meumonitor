import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitorRepository } from '../monitor.repository.js';

test('mantém examType e board separados no perfil do catálogo', () => {
  const repository = new MonitorRepository();
  const buildCatalog = (repository as unknown as {
    buildTaxonomyFromQuestionBank: (rows: unknown[]) => {
      examProfiles: Array<{ id: string; name: string; examType: string; board: string | null }>;
    };
  }).buildTaxonomyFromQuestionBank.bind(repository);

  const catalog = buildCatalog([
    { board: 'FGV', exam_type: 'CONCURSO', subject: 'Português', topic: 'Gramática', subtopic: null, subsubtopic: null, count: 3 },
    { board: null, exam_type: 'ENEM', subject: 'Português', topic: 'Gramática', subtopic: null, subsubtopic: null, count: 2 },
  ]);

  assert.deepEqual(catalog.examProfiles.map(({ name, examType, board }) => ({ name, examType, board })), [
    { name: 'FGV', examType: 'CONCURSO', board: 'FGV' },
    { name: 'ENEM', examType: 'ENEM', board: null },
  ]);
  assert.equal(catalog.examProfiles[0]?.id, 'concurso-fgv');
  assert.equal(catalog.examProfiles[1]?.id, 'enem');
});
