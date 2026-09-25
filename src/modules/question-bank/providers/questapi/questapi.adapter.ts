import type { NormalizedProviderPage, ProviderPageInput } from '../../models/question-bank.model.js';
import { normalizedQuestionBankItemSchema } from '../../models/question-bank.model.js';
import {
  extractImageUrls,
  htmlToPlainText,
  sanitizeQuestionHtml,
} from '../../services/question-bank-content.service.js';
import type { QuestApiPage, QuestApiQuestion } from './questapi.client.js';

type QuestApiPageClient = {
  listQuestions(input: { page: number; perPage: number; board: string; subject: string }): Promise<QuestApiPage>;
};

type QuestApiAdapterOptions = {
  apiSubject: string;
  topic?: string;
  subtopic: string;
  subsubtopic?: string;
  board?: string;
  onQuestionSkipped?: (question: QuestApiQuestion, reason: string) => void;
};

export class QuestApiAdapter {
  constructor(
    private readonly client: QuestApiPageClient,
    private readonly options: QuestApiAdapterOptions = {
      apiSubject: '',
      subtopic: '',
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
          this.options.subtopic,
          this.options.subsubtopic,
          this.options.topic ?? 'Gramática',
          this.options.board ?? 'CESGRANRIO',
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
  subtopic: string,
  subsubtopic?: string,
  topic = 'Gramática',
  defaultBoard = 'CESGRANRIO',
) {
  const statementHtml = sanitizeQuestionHtml([
    `<p>${escapeHtml(question.enunciado)}</p>`,
    ...(question.textos_associados ?? []).map((text) => `<p>${escapeHtml(text)}</p>`),
  ].join(''));
  const correctAnswer = question.gabarito?.trim().toUpperCase() ?? '';
  const imageUrls = collectImageUrls(question);
  const examName = [question.prova.orgao, question.prova.cargo].filter(Boolean).join(' — ') || 'Concurso';
  const examYear = toYear(question.prova.ano);

  return normalizedQuestionBankItemSchema.parse({
    provider: 'QAPI',
    providerQuestionId: question.id,
    externalId: question.numero?.trim() || null,
    examType: 'CONCURSO',
    examName,
    board: question.prova.banca?.trim() || defaultBoard,
    institution: question.prova.orgao?.trim() || null,
    examYear,
    subject: 'Português',
    topic,
    subtopic,
    subsubtopic: subsubtopic ?? null,
    taxonomyPath: [topic, subtopic, ...(subsubtopic ? [subsubtopic] : [])],
    statementHtml,
    statementText: htmlToPlainText(statementHtml),
    alternatives: question.alternativas.map((alternative) => ({
      providerId: null,
      label: alternative.letra.trim().toUpperCase(),
      text: alternative.texto,
      isCorrect: alternative.letra.trim().toUpperCase() === correctAnswer,
    })),
    correctAnswer,
    difficulty: null,
    sourceUrl: `https://api.quest.api.br/v1/questoes/${encodeURIComponent(question.id)}`,
    imageUrls,
    rawPayload: question,
    sourceFetchedAt: new Date(),
  });
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
