import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestApiAdapter } from '../questapi.adapter.js';
import { QuestApiClient } from '../questapi.client.js';

const question = {
  id: '2411689149',
  numero: '1',
  enunciado: 'O enunciado da questão.',
  alternativas: [
    { letra: 'A', texto: 'Alternativa A', imagens: [] },
    { letra: 'B', texto: 'Alternativa B', imagens: [] },
    { letra: 'C', texto: 'Alternativa C', imagens: [] },
    { letra: 'D', texto: 'Alternativa D', imagens: [] },
    { letra: 'E', texto: 'Alternativa E', imagens: [] },
  ],
  gabarito: 'D',
  prova: {
    id: '2411689',
    orgao: 'Casa da Moeda do Brasil',
    cargo: 'Analista',
    ano: '2024',
    banca: 'CESGRANRIO',
    alternative_type: 'MULTIPLA_ESCOLHA',
  },
  classificacao: { materia: 'Fonética' },
  textos_associados: ['Texto de apoio.'],
  anexos: [],
  sinalizadores: { tem_imagem: false, tem_gabarito: true, tem_texto_associado: true },
};

test('normaliza matéria da Quest API na hierarquia de Português e Gramática', async () => {
  const adapter = new QuestApiAdapter({
    listQuestions: async () => ({
      data: { total: 1, page: 1, per_page: 100, items: [question], next_cursor: null },
      meta: { correlationId: 'test', timestamp: new Date().toISOString() },
    }),
  }, {
    apiSubject: 'Fonética',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Fonética',
  });

  const page = await adapter.fetchPage({ page: 1, pageSize: 100 });
  const item = page.items[0];

  assert.equal(item?.provider, 'QAPI');
  assert.equal(item?.subject, 'Português');
  assert.equal(item?.topic, 'Gramática');
  assert.equal(item?.subtopic, 'Fonética e Fonologia');
  assert.equal(item?.subsubtopic, 'Fonética');
  assert.deepEqual(item?.taxonomyPath, ['Gramática', 'Fonética e Fonologia', 'Fonética']);
  assert.equal(item?.examType, 'CONCURSO');
  assert.equal(item?.board, 'CESGRANRIO');
  assert.equal(item?.examYear, 2024);
  assert.equal(item?.correctAnswer, 'D');
  assert.match(item?.statementText ?? '', /Texto de apoio/);
});

test('cliente Quest API envia filtros exatos e exige gabarito', async () => {
  const requests: Request[] = [];
  const client = new QuestApiClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ data: { total: 0, page: 1, per_page: 100, items: [], next_cursor: null } }), { status: 200 });
    },
  });

  await client.listQuestions({ page: 2, perPage: 100, board: 'CESGRANRIO', subject: 'Elementos de gramática' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.headers.get('X-API-Key'), 'test-key');
  const url = new URL(requests[0]!.url);
  assert.equal(url.searchParams.get('banca'), 'CESGRANRIO');
  assert.equal(url.searchParams.get('materia'), 'Elementos de gramática');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('include_gabarito'), 'true');
});

test('não normaliza nem salva questão quando a API não retorna gabarito', async () => {
  const skipped: string[] = [];
  const adapter = new QuestApiAdapter({
    listQuestions: async () => ({
      data: {
        total: 1,
        page: 1,
        per_page: 100,
        items: [{ ...question, gabarito: null }],
        next_cursor: null,
      },
    }),
  }, {
    apiSubject: 'Fonética',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Fonética',
    onQuestionSkipped: (item, reason) => skipped.push(`${item.id}:${reason}`),
  });

  const page = await adapter.fetchPage({ page: 1, pageSize: 100 });

  assert.equal(page.items.length, 0);
  assert.deepEqual(skipped, ['2411689149:gabarito ausente']);
});
