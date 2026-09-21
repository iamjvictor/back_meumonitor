import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { EnemHubAdapter } from '../modules/question-bank/providers/enemhub/enemhub.adapter.js';
import { EnemHubClient } from '../modules/question-bank/providers/enemhub/enemhub.client.js';
import { PrismaQuestionBankPersistence } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import type { QuestionBankItemDelegate } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import { QuestionBankRepository } from '../modules/question-bank/repositories/question-bank.repository.js';
import { importQuestionBankPages } from '../modules/question-bank/services/question-bank-import.service.js';

const apiKey = process.env.ENEMHUB_API_KEY;
if (!apiKey) throw new Error('ENEMHUB_API_KEY não configurada no backend/.env.');

const pageSize = Number(process.env.ENEMHUB_PAGE_SIZE ?? 100);
const year = readNumberOption('--year');
const maxPages = readNumberOption('--max-pages');
const subject = readStringOption('--subject') ?? 'Matemática';
const dryRun = process.argv.includes('--dry-run');

const client = new EnemHubClient({
  apiKey,
  baseUrl: process.env.ENEMHUB_API_BASE_URL,
  timeoutMs: Number(process.env.ENEMHUB_TIMEOUT_MS ?? 90_000),
  minIntervalMs: Number(process.env.ENEMHUB_MIN_INTERVAL_MS ?? 6_500),
});
const adapter = new EnemHubAdapter(client, { subjectName: subject });

const persistence = dryRun
  ? {
      upsert: async () => ({ id: 'dry-run', created: true }),
      findByProviderQuestionId: async () => null,
      countByProvider: async () => 0,
      listImportFailures: async () => [],
    }
  : new PrismaQuestionBankPersistence(prisma.questionBankItem as unknown as QuestionBankItemDelegate);

try {
  const result = await importQuestionBankPages({
    adapter,
    repository: new QuestionBankRepository(persistence),
    pageSize,
    year,
    maxPages,
    onPage: (progress) => console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'import', ...progress })),
  });
  console.log(JSON.stringify({ subject, completed: result }));
} finally {
  if (!dryRun) await prisma.$disconnect();
}

function readNumberOption(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const optionIndex = process.argv.indexOf(name);
  if (!inline && optionIndex === -1) return undefined;
  const value = inline?.slice(name.length + 1) ?? process.argv[optionIndex + 1];
  if (!value) throw new Error(`${name} requer um valor inteiro positivo, por exemplo: ${name} 1.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} precisa ser um inteiro positivo.`);
  return parsed;
}

function readStringOption(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const optionIndex = process.argv.indexOf(name);
  if (!inline && optionIndex === -1) return undefined;
  const value = inline?.slice(name.length + 1) ?? process.argv[optionIndex + 1];
  if (!value) throw new Error(`${name} requer um valor, por exemplo: ${name} Física.`);
  return value;
}
