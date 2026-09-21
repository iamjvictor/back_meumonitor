import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeQuestionContentHash,
  extractImageUrls,
  htmlToPlainText,
  normalizeDifficulty,
  sanitizeQuestionHtml,
  splitTaxonomyPath,
} from '../question-bank-content.service.js';

test('separa caminho de taxonomia e remove espaços vazios', () => {
  assert.deepEqual(splitTaxonomyPath(' Geometria > Geometria Plana > Áreas e Perímetros '), [
    'Geometria', 'Geometria Plana', 'Áreas e Perímetros',
  ]);
  assert.deepEqual(splitTaxonomyPath(''), []);
});

test('normaliza dificuldades dos provedores para valores estáveis', () => {
  assert.equal(normalizeDifficulty('Fácil'), 'EASY');
  assert.equal(normalizeDifficulty('Média'), 'MEDIUM');
  assert.equal(normalizeDifficulty('DIFÍCIL'), 'HARD');
  assert.equal(normalizeDifficulty('unknown-value'), null);
});

test('extrai imagens e remove conteúdo executável do HTML', () => {
  const html = '<p>Texto</p><img src="https://example.com/a.png" onerror="alert(1)"><script>alert(2)</script>';
  assert.deepEqual(extractImageUrls(html), ['https://example.com/a.png']);
  assert.equal(sanitizeQuestionHtml(html), '<p>Texto</p><img src="https://example.com/a.png">');
  assert.equal(htmlToPlainText(html), 'Texto');
});

test('calcula hash determinístico para o conteúdo da questão', () => {
  const input = {
    provider: 'ENEMHUB',
    providerQuestionId: 'q-1',
    subject: 'Matemática',
    topic: 'Álgebra > Logaritmo',
    statementText: 'Uma questão',
    alternatives: [{ label: 'A', text: 'Resposta' }],
    correctAnswer: 'A',
  };
  const first = computeQuestionContentHash(input);
  assert.equal(first, computeQuestionContentHash({ ...input }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, computeQuestionContentHash({ ...input, correctAnswer: 'B' }));
  assert.equal(
    first,
    computeQuestionContentHash({ ...input, provider: 'QAPI', providerQuestionId: 'qapi-1' }),
  );
});
