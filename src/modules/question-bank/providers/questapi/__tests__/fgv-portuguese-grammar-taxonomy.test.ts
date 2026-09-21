import assert from 'node:assert/strict';
import test from 'node:test';
import { FGV_PORTUGUESE_GRAMMAR_SUBJECTS } from '../fgv-portuguese-grammar-taxonomy.js';

test('mapeia as 26 matérias FGV encontradas para Gramática e seus subtopics', () => {
  assert.equal(FGV_PORTUGUESE_GRAMMAR_SUBJECTS.length, 26);
  assert.equal(new Set(FGV_PORTUGUESE_GRAMMAR_SUBJECTS.map((item) => item.apiSubject)).size, 26);
  assert.ok(FGV_PORTUGUESE_GRAMMAR_SUBJECTS.every((item) => item.topic === 'Gramática'));

  const reescrita = FGV_PORTUGUESE_GRAMMAR_SUBJECTS.find((item) => item.apiSubject === 'Reorganização e reescrita de orações e períodos');
  assert.deepEqual(reescrita, {
    apiSubject: 'Reorganização e reescrita de orações e períodos',
    topic: 'Gramática',
    subtopic: 'Período Composto',
    subsubtopic: 'Reorganização e reescrita de orações e períodos',
    expectedCount: 21,
  });

  const crase = FGV_PORTUGUESE_GRAMMAR_SUBJECTS.find((item) => item.apiSubject === 'Emprego do sinal indicativo de crase');
  assert.deepEqual(crase, {
    apiSubject: 'Emprego do sinal indicativo de crase',
    topic: 'Gramática',
    subtopic: 'Crase',
    subsubtopic: 'Emprego do sinal indicativo de crase',
    expectedCount: 14,
  });
});
