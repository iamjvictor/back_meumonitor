import assert from 'node:assert/strict';
import test from 'node:test';
import { mapQuestionPracticeProvenance } from '../question-practice-provenance.js';

test('prefers relation fields and image URLs when present', () => {
  assert.deepEqual(mapQuestionPracticeProvenance({
    questionBankItem: {
      imageUrls: ['https://cdn.example.org/current.png'],
      board: 'CESGRANRIO',
      examName: 'Concurso Banco X',
      examYear: 2024,
      sourceUrl: 'https://source.example.org/current',
    },
    metadata: {
      imageUrls: ['https://cdn.example.org/snapshot.png'],
      board: 'OUTRA BANCA',
      examName: 'Outro exame',
      examYear: 2020,
      sourceUrl: 'https://source.example.org/snapshot',
    },
  }), {
    imageUrls: ['https://cdn.example.org/current.png'],
    provenance: {
      board: 'CESGRANRIO',
      examName: 'Concurso Banco X',
      examYear: 2024,
      sourceUrl: 'https://source.example.org/current',
    },
  });
});

test('falls back to snapshot when relation values are missing or empty', () => {
  assert.deepEqual(mapQuestionPracticeProvenance({
    questionBankItem: {
      imageUrls: [],
      board: '  ',
      examName: null,
      examYear: null,
      sourceUrl: null,
    },
    metadata: {
      imageUrls: ['https://cdn.example.org/snapshot.png'],
      board: 'INSTITUTO AOCP',
      examName: 'Concurso Federal',
      examYear: 2019,
      sourceUrl: 'https://source.example.org/original',
    },
  }), {
    imageUrls: ['https://cdn.example.org/snapshot.png'],
    provenance: {
      board: 'INSTITUTO AOCP',
      examName: 'Concurso Federal',
      examYear: 2019,
      sourceUrl: 'https://source.example.org/original',
    },
  });
});

test('combines partial relation and snapshot metadata', () => {
  assert.deepEqual(mapQuestionPracticeProvenance({
    questionBankItem: {
      imageUrls: ['https://cdn.example.org/current.png'],
      board: 'CESGRANRIO',
      examName: null,
      examYear: 2023,
      sourceUrl: null,
    },
    metadata: {
      imageUrls: ['https://cdn.example.org/snapshot.png'],
      board: 'OUTRA BANCA',
      examName: 'ENEM',
      examYear: 2008,
      sourceUrl: 'https://source.example.org/enem-2008',
    },
  }), {
    imageUrls: ['https://cdn.example.org/current.png'],
    provenance: {
      board: 'CESGRANRIO',
      examName: 'ENEM',
      examYear: 2023,
      sourceUrl: 'https://source.example.org/enem-2008',
    },
  });
});

test('returns safe empty values for non-bank questions', () => {
  assert.deepEqual(mapQuestionPracticeProvenance({ questionBankItem: null, metadata: null }), {
    imageUrls: [],
    provenance: null,
  });
});

test('ignores malformed metadata and invalid image values', () => {
  assert.deepEqual(mapQuestionPracticeProvenance({
    questionBankItem: {
      imageUrls: [42, ' ', null],
      board: null,
      examName: null,
      examYear: '2008',
      sourceUrl: ' ',
    },
    metadata: ['not', 'an', 'object'],
  }), {
    imageUrls: [],
    provenance: null,
  });
});
