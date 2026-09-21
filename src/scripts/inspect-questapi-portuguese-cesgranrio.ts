import 'dotenv/config';

const apiKey = process.env.QUESTAPI_API_KEY;
if (!apiKey) throw new Error('QUESTAPI_API_KEY não configurada no backend/.env.');
const configuredApiKey = apiKey;

const baseUrl = process.env.QUESTAPI_API_BASE_URL ?? 'https://api.quest.api.br';

const boards = await getJson<{ data?: { items?: string[] } }>('/v1/filtros/bancas?q=cesgranrio&per_page=10');
const subjects = await getJson<{ data?: { items?: string[] } }>('/v1/filtros/materias?q=portugues&limit=10');
const board = boards.data?.items?.find((item) => /cesgranrio/i.test(item));
const subject = subjects.data?.items?.find((item) => item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'portugues')
  ?? subjects.data?.items?.[0];

if (!board) throw new Error('A Quest API não retornou uma banca correspondente a Cesgranrio.');
if (!subject) throw new Error('A Quest API não retornou uma matéria correspondente a Português.');

const params = new URLSearchParams({ banca: board, materia: subject, per_page: '1', include_gabarito: 'false' });
const body = await getJson(`/v1/questoes?${params.toString()}`);
console.log(JSON.stringify({ resolvedFilters: { banca: board, materia: subject }, response: body }, null, 2));

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: 'application/json', 'X-API-Key': configuredApiKey },
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`Quest API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
}
