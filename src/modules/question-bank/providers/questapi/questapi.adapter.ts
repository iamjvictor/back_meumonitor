import type { NormalizedProviderPage, ProviderPageInput, QuestionBankExamType } from '../../models/question-bank.model.js';
import { normalizedQuestionBankItemSchema } from '../../models/question-bank.model.js';
import {
  extractImageUrls,
  htmlToPlainText,
  normalizeDifficulty,
  sanitizeQuestionHtml,
} from '../../services/question-bank-content.service.js';
import type { QuestApiExam, QuestApiPage, QuestApiQuestion } from './questapi.client.js';

type QuestApiPageClient = {
  listQuestions(input: { page: number; perPage: number; board: string; subject: string }): Promise<QuestApiPage>;
};

type QuestApiAdapterOptions = {
  apiSubject: string;
  subject?: string;
  topic?: string;
  subtopic?: string;
  subsubtopic?: string;
  board?: string;
  examType?: QuestionBankExamType;
  examName?: string;
  institution?: string;
  onQuestionSkipped?: (question: QuestApiQuestion, reason: string) => void;
};

export class QuestApiAdapter {
  constructor(
    private readonly client: QuestApiPageClient,
    private readonly options: QuestApiAdapterOptions = {
      apiSubject: '',
    },
  ) {}

  async fetchPage(input: ProviderPageInput): Promise<NormalizedProviderPage> {
    const page = await this.client.listQuestions({
      page: input.page,
      perPage: input.pageSize,
      board: this.options.board ?? 'CESGRANRIO',
      subject: this.options.apiSubject,
    });
    const total = page.data.total ?? null;
    const items = [];
    for (const question of page.data.items) {
      if (!question.gabarito?.trim()) {
        this.options.onQuestionSkipped?.(question, 'gabarito ausente');
        continue;
      }
      try {
        items.push(normalizeQuestApiQuestion(
          question,
          this.options,
        ));
      } catch (error) {
        this.options.onQuestionSkipped?.(question, error instanceof Error ? error.message : String(error));
      }
    }
    return {
      items,
      page: page.data.page ?? input.page,
      pageSize: page.data.per_page ?? input.pageSize,
      total,
      hasNextPage: total === null
        ? page.data.items.length === input.pageSize
        : input.page * input.pageSize < total,
    };
  }
}

export function normalizeQuestApiQuestion(
  question: QuestApiQuestion,
  options: QuestApiAdapterOptions,
) {
  const statementHtml = sanitizeQuestionHtml([question.enunciado, ...(question.textos_associados ?? [])].join('\n'));
  const correctAnswer = question.gabarito?.trim().toUpperCase() ?? '';
  const imageUrls = collectImageUrls(question);
  const exam = getExam(question);
  const subject = options.subject ?? 'Português';
  const topic = options.topic ?? question.classificacao?.assunto?.trim() ?? 'Gramática';
  const subtopic = options.subtopic ?? null;
  const subsubtopic = options.subsubtopic ?? null;
  const examName = options.examName ?? ([exam?.orgao, exam?.cargo].filter(Boolean).join(' — ') || 'Concurso');
  const examYear = toYear(exam?.ano);

  return normalizedQuestionBankItemSchema.parse({
    provider: 'QAPI',
    providerQuestionId: question.id,
    externalId: question.numero?.trim() || null,
    examType: options.examType ?? 'CONCURSO',
    examName,
    board: exam?.banca?.trim() || options.board || null,
    institution: options.institution ?? exam?.orgao?.trim() ?? null,
    examYear,
    subject,
    topic,
    subtopic,
    subsubtopic,
    taxonomyPath: [topic, ...(subtopic ? [subtopic] : []), ...(subsubtopic ? [subsubtopic] : [])],
    statementHtml,
    statementText: htmlToPlainText(statementHtml),
    alternatives: question.alternativas.map((alternative) => ({
      providerId: null,
      label: alternative.letra.trim().toUpperCase(),
      text: sanitizeQuestionHtml(alternative.texto),
      isCorrect: alternative.letra.trim().toUpperCase() === correctAnswer,
    })),
    correctAnswer,
    difficulty: typeof question.dificuldade === 'string' ? normalizeDifficulty(question.dificuldade) : null,
    sourceUrl: `https://api.quest.api.br/v2/questoes/${encodeURIComponent(question.id)}`,
    imageUrls,
    rawPayload: question,
    sourceFetchedAt: new Date(),
  });
}

function getExam(question: QuestApiQuestion): QuestApiExam | null {
  return question.provas?.[0] ?? question.prova ?? null;
}

function collectImageUrls(question: QuestApiQuestion) {
  const urls = new Set<string>();
  for (const alternative of question.alternativas) {
    for (const image of alternative.imagens ?? []) if (/^https?:\/\//i.test(image)) urls.add(image);
  }
  for (const attachment of question.anexos ?? []) {
    const url = typeof attachment === 'string' ? attachment : attachment.url;
    if (url && /^https?:\/\//i.test(url)) urls.add(url);
  }
  return [...urls, ...extractImageUrls(question.enunciado)];
}

function toYear(value: string | number | null | undefined) {
  const year = Number(value);
  return Number.isInteger(year) && year > 0 ? year : null;
}
