import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorSchema } from '../monitor.model.js';

const base = {
  name: 'Monitor de Matemática',
  subjects: [{ name: 'Matemática', topics: [{ name: 'Álgebra' }] }],
};

test('aceita monitor próprio sem seleção do banco de questões', () => {
  const result = createMonitorSchema.safeParse(base);

  assert.equal(result.success, true);
});

test('aceita seleção opcional do banco com perfil e recorte taxonômico', () => {
  const result = createMonitorSchema.safeParse({
    ...base,
    questionBankSelections: [{
      subject: 'Matemática',
      topic: 'Álgebra',
      examType: 'CONCURSO',
      board: 'FGV',
      subtopic: 'Equações',
      subsubtopic: '1º grau',
    }],
  });

  assert.equal(result.success, true);
});

test('rejeita subsubtópico sem subtópico', () => {
  const result = createMonitorSchema.safeParse({
    ...base,
    questionBankSelections: [{
      subject: 'Matemática',
      topic: 'Álgebra',
      examType: 'ENEM',
      subsubtopic: '1º grau',
    }],
  });

  assert.equal(result.success, false);
});

test('aceita matéria com mais de 30 tópicos importados do acervo', () => {
  const result = createMonitorSchema.safeParse({
    name: 'Monitor amplo',
    subjects: [{
      name: 'Matemática',
      topics: Array.from({ length: 31 }, (_, index) => ({ name: `Tópico ${index + 1}` })),
    }],
    questionBankSelections: [],
  });

  assert.equal(result.success, true);
});
