import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMonitorTopicHierarchy,
  buildSelectionWhere,
  normalizeQuestionBankSelection,
} from '../question-bank-selection.service.js';

test('normaliza caminhos em tópico raiz, subtópico e subsubtópico sem duplicar raízes', () => {
  const hierarchy = buildMonitorTopicHierarchy([
    { name: 'Álgebra > Funções' },
    { name: 'Álgebra > Matrizes' },
    { name: 'Álgebra > Sequências > Progressão Aritmética' },
    { name: 'Álgebra > Sequências > Progressão Geométrica' },
  ]);

  assert.equal(hierarchy.length, 1);
  assert.equal(hierarchy[0]?.name, 'Álgebra');
  assert.deepEqual(hierarchy[0]?.subtopics.map((item) => item.name), ['Funções', 'Matrizes', 'Sequências']);
  assert.deepEqual(hierarchy[0]?.subtopics[2]?.subsubtopics.map((item) => item.name), [
    'Progressão Aritmética',
    'Progressão Geométrica',
  ]);
});

test('normalizes profile and taxonomy values without changing accents', () => {
  const result = normalizeQuestionBankSelection({
    subject: '  Língua Portuguesa  ',
    topic: '  Sintaxe ',
    examType: ' enem ',
    board: '  FGV  ',
    subtopic: '  Orações subordinadas ',
    subsubtopic: '  Adjetivas  ',
  });

  assert.deepEqual(result, {
    subject: 'Língua Portuguesa',
    topic: 'Sintaxe',
    examType: 'ENEM',
    board: 'FGV',
    subtopic: 'Orações subordinadas',
    subsubtopic: 'Adjetivas',
    selectionKey: 'ENEM|FGV|LÍNGUA PORTUGUESA|SINTAXE|ORAÇÕES SUBORDINADAS|ADJETIVAS',
  });
});

test('normalizes empty board and taxonomy levels to null', () => {
  const result = normalizeQuestionBankSelection({
    subject: 'Matemática',
    topic: 'Álgebra',
    examType: 'enem',
    board: '   ',
    subtopic: '',
    subsubtopic: null,
  });

  assert.equal(result.board, null);
  assert.equal(result.subtopic, null);
  assert.equal(result.subsubtopic, null);
  assert.equal(result.selectionKey, 'ENEM||MATEMÁTICA|ÁLGEBRA||');
});

test('rejects a subsubtopic without a subtopic', () => {
  assert.throws(
    () => normalizeQuestionBankSelection({
      subject: 'Matemática',
      topic: 'Álgebra',
      examType: 'ENEM',
      subsubtopic: 'Equação do segundo grau',
    }),
    /subsubtopic requires subtopic/i,
  );
});

test('builds a topic-wide filter without narrowing taxonomy descendants', () => {
  const selection = normalizeQuestionBankSelection({
    subject: 'Matemática',
    topic: 'Álgebra',
    examType: 'ENEM',
  });

  assert.deepEqual(buildSelectionWhere(selection), {
    examType: 'ENEM',
    board: null,
    subject: 'Matemática',
    topic: 'Álgebra',
  });
});

test('builds a subtopic filter without narrowing its subsubtopics', () => {
  const selection = normalizeQuestionBankSelection({
    subject: 'Matemática',
    topic: 'Álgebra',
    examType: 'ENEM',
    subtopic: 'Equações',
  });

  assert.deepEqual(buildSelectionWhere(selection), {
    examType: 'ENEM',
    board: null,
    subject: 'Matemática',
    topic: 'Álgebra',
    subtopic: 'Equações',
  });
});

test('mapeia o subtopic Geral para questões sem subtopic no acervo', () => {
  const selection = normalizeQuestionBankSelection({
    subject: 'Matemática',
    topic: 'Análise de Tabelas e Gráficos',
    examType: 'ENEM',
    subtopic: 'Geral',
  });

  assert.deepEqual(buildSelectionWhere(selection), {
    examType: 'ENEM',
    board: null,
    subject: 'Matemática',
    topic: 'Análise de Tabelas e Gráficos',
    subtopic: null,
  });
});

test('builds an exact subsubtopic filter', () => {
  const selection = normalizeQuestionBankSelection({
    subject: 'Matemática',
    topic: 'Álgebra',
    examType: 'ENEM',
    subtopic: 'Equações',
    subsubtopic: 'Equação do segundo grau',
  });

  assert.deepEqual(buildSelectionWhere(selection), {
    examType: 'ENEM',
    board: null,
    subject: 'Matemática',
    topic: 'Álgebra',
    subtopic: 'Equações',
    subsubtopic: 'Equação do segundo grau',
  });
});
