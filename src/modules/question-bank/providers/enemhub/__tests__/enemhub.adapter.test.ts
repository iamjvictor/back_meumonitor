import assert from 'node:assert/strict';
import test from 'node:test';
import { EnemHubAdapter } from '../enemhub.adapter.js';

const question = {
  id: 'question-1',
  externalId: '123',
  year: 2023,
  difficulty: 'Média',
  statement: '<p>Questão de matemática</p><img src="https://example.com/image.png">',
  correctAlternative: 'B',
  exam: { id: 'exam-1', name: 'ENEM', institution: null },
  subject: {
    id: 'subject-1',
    name: 'Matemática',
    area: 'Geometria > Geometria Plana > Áreas e Perímetros > Triângulos',
  },
  alternatives: [
    { id: 'a', letter: 'A', text: 'Errada', isCorrect: false },
    { id: 'b', letter: 'B', text: 'Correta', isCorrect: true },
  ],
};

test('normaliza a taxonomia do EnemHub em três camadas', async () => {
  const adapter = new EnemHubAdapter({
    listQuestions: async () => ({ data: [question], meta: { page: 1, limit: 100, total: 1 } }),
  });

  const page = await adapter.fetchPage({ page: 1, pageSize: 100 });
  const item = page.items[0];

  assert.equal(item?.subject, 'Matemática');
  assert.equal(item?.topic, 'Geometria');
  assert.equal(item?.subtopic, 'Geometria Plana');
  assert.equal(item?.subsubtopic, 'Áreas e Perímetros > Triângulos');
  assert.deepEqual(item?.taxonomyPath, ['Geometria', 'Geometria Plana', 'Áreas e Perímetros', 'Triângulos']);
  assert.equal(item?.difficulty, 'MEDIUM');
  assert.deepEqual(item?.imageUrls, ['https://example.com/image.png']);
});

test('cliente EnemHub envia autenticação, paginação e filtros', async () => {
  const requests: Request[] = [];
  const client = new (await import('../enemhub.client.js')).EnemHubClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ data: [], meta: { page: 2, limit: 100, total: 100 } }), { status: 200 });
    },
  });

  await client.listQuestions({ page: 2, limit: 100, year: 2023, subjectId: 'subject-1' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.headers.get('X-API-Key'), 'test-key');
  const url = new URL(requests[0]!.url);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('year'), '2023');
  assert.equal(url.searchParams.get('subjectId'), 'subject-1');
});
