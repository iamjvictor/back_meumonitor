import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { FGV_PORTUGUESE_GRAMMAR_SUBJECTS } from '../modules/question-bank/providers/questapi/fgv-portuguese-grammar-taxonomy.js';
import { QuestApiAdapter } from '../modules/question-bank/providers/questapi/questapi.adapter.js';
import { QuestApiClient } from '../modules/question-bank/providers/questapi/questapi.client.js';
import { PrismaQuestionBankPersistence } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import type { QuestionBankItemDelegate } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import { QuestionBankRepository } from '../modules/question-bank/repositories/question-bank.repository.js';
import { importQuestionBankPages } from '../modules/question-bank/services/question-bank-import.service.js';

const apiKey = process.env.QUESTAPI_API_KEY;
if (!apiKey) throw new Error('QUESTAPI_API_KEY não configurada no backend/.env.');

const dryRun = process.argv.includes('--dry-run');
const pageSize = readNumberOption('--page-size') ?? 100;
const maxPages = readNumberOption('--max-pages');
const client = new QuestApiClient({
  apiKey,
  baseUrl: process.env.QUESTAPI_API_BASE_URL,
  minIntervalMs: Number(process.env.QUESTAPI_MIN_INTERVAL_MS ?? 1_100),
});
const persistence = dryRun
  ? {
      upsert: async () => ({ id: 'dry-run', created: true }),
      findByProviderQuestionId: async () => null,
      countByProvider: async () => 0,
      listImportFailures: async () => [],
    }
  : new PrismaQuestionBankPersistence(prisma.questionBankItem as unknown as QuestionBankItemDelegate);
const skippedQuestions: Array<{ apiSubject: string; id: string; reason: string }> = [];

try {
  const completed = {
    pagesProcessed: 0,
    itemsReceived: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsRejected: 0,
    lastPage: 0,
  };
  const perSubject: Array<{ apiSubject: string; expectedCount: number; importedCount: number; created: number; updated: number }> = [];

  for (const taxonomy of FGV_PORTUGUESE_GRAMMAR_SUBJECTS) {
    const adapter = new QuestApiAdapter(client, {
      apiSubject: taxonomy.apiSubject,
      topic: taxonomy.topic,
      subtopic: taxonomy.subtopic,
      subsubtopic: taxonomy.subsubtopic,
      board: 'FGV',
      onQuestionSkipped: (question, reason) => {
        skippedQuestions.push({ apiSubject: taxonomy.apiSubject, id: question.id, reason });
      },
    });
    const result = await importQuestionBankPages({
      adapter,
      repository: new QuestionBankRepository(persistence),
      pageSize,
      maxPages,
      onPage: (progress) => console.log(JSON.stringify({
        mode: dryRun ? 'dry-run' : 'import',
        board: 'FGV',
        apiSubject: taxonomy.apiSubject,
        hierarchy: ['Português', taxonomy.topic, taxonomy.subtopic, taxonomy.subsubtopic],
        expectedCountFromDiscovery: taxonomy.expectedCount,
        ...progress,
      })),
    });
    for (const key of Object.keys(completed) as Array<keyof typeof completed>) completed[key] += result[key];
    perSubject.push({
      apiSubject: taxonomy.apiSubject,
      expectedCount: taxonomy.expectedCount,
      importedCount: result.itemsReceived,
      created: result.itemsCreated,
      updated: result.itemsUpdated,
    });
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'import',
    board: 'FGV',
    subject: 'Português',
    topic: 'Gramática',
    totalExpectedFromDiscovery: FGV_PORTUGUESE_GRAMMAR_SUBJECTS.reduce((sum, item) => sum + item.expectedCount, 0),
    completed,
    skippedQuestions,
    perSubject,
  }, null, 2));
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
