import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { QuestApiAdapter } from '../modules/question-bank/providers/questapi/questapi.adapter.js';
import { QuestApiClient } from '../modules/question-bank/providers/questapi/questapi.client.js';
import { PrismaQuestionBankPersistence } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import type { QuestionBankItemDelegate } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import { QuestionBankRepository } from '../modules/question-bank/repositories/question-bank.repository.js';
import { importQuestionBankPages } from '../modules/question-bank/services/question-bank-import.service.js';

const apiKey = process.env.QUESTAPI_API_KEY;
if (!apiKey) throw new Error('QUESTAPI_API_KEY não configurada no backend/.env.');

const subjects = [
  {
    apiSubject: 'Concepções de gramática (tipos de gramática; metalinguagem)',
    subtopic: 'Concepções de gramática (tipos de gramática; metalinguagem)',
    subsubtopic: undefined,
  },
  {
    apiSubject: 'Elementos de gramática',
    subtopic: 'Elementos de gramática',
    subsubtopic: undefined,
  },
  {
    apiSubject: 'Dificuldades da língua portuguesa',
    subtopic: 'Dificuldades da língua portuguesa',
    subsubtopic: undefined,
  },
  {
    apiSubject: 'Alfabeto português',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Alfabeto português',
  },
  {
    apiSubject: 'Fonética',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Fonética',
  },
  {
    apiSubject: 'Fonologia',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Fonologia',
  },
  {
    apiSubject: 'Mudanças fonéticas',
    subtopic: 'Fonética e Fonologia',
    subsubtopic: 'Mudanças fonéticas',
  },
  {
    apiSubject: 'Classificação dos substantivos',
    subtopic: 'Substantivos',
    subsubtopic: 'Classificação dos substantivos',
  },
  {
    apiSubject: 'Flexão do substantivo',
    subtopic: 'Substantivos',
    subsubtopic: 'Flexão do substantivo',
  },
  {
    apiSubject: 'Grau do substantivo',
    subtopic: 'Substantivos',
    subsubtopic: 'Grau do substantivo',
  },
  {
    apiSubject: 'Plural dos substantivos compostos',
    subtopic: 'Substantivos',
    subsubtopic: 'Plural dos substantivos compostos',
  },
] as const;
const pageSize = readNumberOption('--page-size') ?? 100;
const maxPages = readNumberOption('--max-pages');
const dryRun = process.argv.includes('--dry-run');
const board = 'CESGRANRIO';

const client = new QuestApiClient({
  apiKey,
  baseUrl: process.env.QUESTAPI_API_BASE_URL,
});
const persistence = dryRun
  ? {
      upsert: async () => ({ id: 'dry-run', created: true }),
      findByProviderQuestionId: async () => null,
      countByProvider: async () => 0,
      listImportFailures: async () => [],
    }
  : new PrismaQuestionBankPersistence(prisma.questionBankItem as unknown as QuestionBankItemDelegate);

try {
  const totals = { pagesProcessed: 0, itemsReceived: 0, itemsCreated: 0, itemsUpdated: 0, itemsRejected: 0, lastPage: 0 };
  for (const taxonomy of subjects) {
    const adapter = new QuestApiAdapter(client, {
      apiSubject: taxonomy.apiSubject,
      subtopic: taxonomy.subtopic,
      subsubtopic: taxonomy.subsubtopic,
      board,
    });
    const result = await importQuestionBankPages({
      adapter,
      repository: new QuestionBankRepository(persistence),
      pageSize,
      maxPages,
      onPage: (progress) => console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'import', ...taxonomy, ...progress })),
    });
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += result[key];
  }
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'import', board, subjects, completed: totals }));
} finally {
  if (!dryRun) await prisma.$disconnect();
}

function readNumberOption(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const optionIndex = process.argv.indexOf(name);
  if (!inline && optionIndex === -1) return undefined;
  const value = inline?.slice(name.length + 1) ?? process.argv[optionIndex + 1];
  if (!value) throw new Error(`${name} requer um valor inteiro positivo.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} precisa ser um inteiro positivo.`);
  return parsed;
}
