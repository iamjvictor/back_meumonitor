import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma.js';
import { QuestApiAdapter } from '../modules/question-bank/providers/questapi/questapi.adapter.js';
import { QuestApiClient } from '../modules/question-bank/providers/questapi/questapi.client.js';
import { PrismaQuestionBankPersistence } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import type { QuestionBankItemDelegate } from '../modules/question-bank/repositories/prisma-question-bank.persistence.js';
import { QuestionBankRepository } from '../modules/question-bank/repositories/question-bank.repository.js';
import { importQuestionBankPages } from '../modules/question-bank/services/question-bank-import.service.js';

const apiKey = readQuestApiKey();

const SUBJECTS = [
  'Língua Portuguesa',
  'Matemática',
  'Física',
  'Química',
  'Biologia',
] as const;

const EXAM_PROFILES = {
  espcex: {
    board: 'ESPCEX',
    examType: 'MILITAR' as const,
    examName: 'Concurso de Admissão à EsPCEx',
    institution: 'Escola Preparatória de Cadetes do Exército',
  },
  uerj: {
    board: 'UERJ',
    examType: 'VESTIBULAR' as const,
    examName: 'Vestibular Estadual da UERJ',
    institution: 'Universidade do Estado do Rio de Janeiro',
  },
  fuvest: {
    board: 'FUVEST',
    examType: 'VESTIBULAR' as const,
    examName: 'Vestibular FUVEST',
    institution: 'Universidade de São Paulo',
  },
  cebraspe: {
    board: 'CESPE CEBRASPE',
    examType: 'CONCURSO' as const,
  },
} as const;

const dryRun = process.argv.includes('--dry-run');
const pageSize = readPositiveIntegerOption('--page-size') ?? 100;
const maxPages = readPositiveIntegerOption('--max-pages');
const examKey = readStringOption('--exam') ?? 'espcex';
const resumeSubject = readRawStringOption('--resume-subject');
const resumePage = readPositiveIntegerOption('--resume-page') ?? 1;
const onlySubject = readRawStringOption('--only-subject');
if (onlySubject && !SUBJECTS.includes(onlySubject as typeof SUBJECTS[number])) {
  throw new Error(`Matéria desconhecida: ${onlySubject}. Use uma das matérias configuradas no script.`);
}
const subjectsToImport = onlySubject ? [onlySubject] : SUBJECTS;
const profile = EXAM_PROFILES[examKey as keyof typeof EXAM_PROFILES];
if (!profile) throw new Error(`Perfil de exame desconhecido: ${examKey}. Use espcex, uerj, fuvest ou cebraspe.`);
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

const skippedQuestions: Array<{ subject: string; id: string; reason: string }> = [];

try {
  const totals = { pagesProcessed: 0, itemsReceived: 0, itemsCreated: 0, itemsUpdated: 0, itemsRejected: 0, lastPage: 0 };
  const perSubject: Array<{ subject: string; pagesProcessed: number; imported: number; created: number; updated: number; rejected: number }> = [];

  let resumeReached = !resumeSubject;
  for (const subject of subjectsToImport) {
    if (!resumeReached) {
      if (subject !== resumeSubject) continue;
      resumeReached = true;
    }
    const adapter = new QuestApiAdapter(client, {
      apiSubject: subject,
      subject,
      board: profile.board,
      examType: profile.examType,
      examName: 'examName' in profile ? profile.examName : undefined,
      institution: 'institution' in profile ? profile.institution : undefined,
      onQuestionSkipped: (question, reason) => skippedQuestions.push({ subject, id: question.id, reason }),
    });
    const result = await importQuestionBankPages({
      adapter,
      repository: new QuestionBankRepository(persistence),
      pageSize,
      startPage: subject === resumeSubject ? resumePage : 1,
      maxPages,
      onPage: (progress) => console.log(JSON.stringify({
        mode: dryRun ? 'dry-run' : 'import',
        board: profile.board,
        subject,
        ...progress,
      })),
    });
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += result[key];
    perSubject.push({
      subject,
      pagesProcessed: result.pagesProcessed,
      imported: result.itemsReceived,
      created: result.itemsCreated,
      updated: result.itemsUpdated,
      rejected: result.itemsRejected,
    });
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'import',
    board: profile.board,
    examType: profile.examType,
    subjects: subjectsToImport,
    totals,
    perSubject,
    skippedQuestions,
    skippedByReason: Object.entries(groupByReason(skippedQuestions)),
  }, null, 2));
} finally {
  if (!dryRun) await prisma.$disconnect();
}

function readPositiveIntegerOption(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  const position = process.argv.indexOf(name);
  if (!inline && position === -1) return undefined;
  const value = inline?.slice(name.length + 1) ?? process.argv[position + 1];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} precisa ser um inteiro positivo.`);
  return parsed;
}

function readStringOption(name: string) {
  const value = readRawStringOption(name);
  return value?.toLowerCase();
}

function readRawStringOption(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  const position = process.argv.indexOf(name);
  if (!inline && position === -1) return undefined;
  const value = inline?.slice(name.length + 1) ?? process.argv[position + 1];
  if (!value?.trim()) throw new Error(`${name} requer um valor.`);
  return value.trim();
}

function readQuestApiKey() {
  const testTokenFile = resolve(process.cwd(), '../TetseAPIFY.ts');
  const testToken = readFileSync(testTokenFile, 'utf8')
    .match(/const API_TOKEN\s*=\s*["']([^"']+)["']/)?.[1];
  if (testToken?.startsWith('qk_')) return testToken;

  const configuredKey = process.env.QUESTAPI_API_KEY;
  if (configuredKey?.startsWith('qk_')) return configuredKey;

  throw new Error('Nenhuma chave Quest API válida foi encontrada em TetseAPIFY.ts ou QUESTAPI_API_KEY.');
}

function groupByReason(items: Array<{ reason: string }>) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
}
