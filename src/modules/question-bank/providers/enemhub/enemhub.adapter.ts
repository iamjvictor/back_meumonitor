import type {
  NormalizedProviderPage,
  ProviderPageInput,
} from '../../models/question-bank.model.js';
import { normalizedQuestionBankItemSchema } from '../../models/question-bank.model.js';
import {
  extractImageUrls,
  htmlToPlainText,
  normalizeDifficulty,
  sanitizeQuestionHtml,
  splitTaxonomyPath,
} from '../../services/question-bank-content.service.js';
import type { EnemHubPage, EnemHubQuestion } from './enemhub.client.js';

type EnemHubPageClient = {
  listQuestions(input: { page: number; limit: number; year?: number; subjectId?: string }): Promise<EnemHubPage>;
};

export class EnemHubAdapter {
  constructor(
    private readonly client: EnemHubPageClient,
    private readonly options: { subjectName?: string } = {},
  ) {}

  async fetchPage(input: ProviderPageInput): Promise<NormalizedProviderPage> {
    const page = await this.client.listQuestions({
      page: input.page,
      limit: input.pageSize,
      year: input.year,
      subjectId: input.subjectId,
    });
    const items = page.data
      .filter((question) => !this.options.subjectName || question.subject.name === this.options.subjectName)
      .map((question) => normalizeEnemHubQuestion(question));
    const total = page.meta?.total ?? null;
    return {
      items,
      page: page.meta?.page ?? input.page,
      pageSize: page.meta?.limit ?? input.pageSize,
      total,
      hasNextPage: total === null ? items.length === input.pageSize : input.page * input.pageSize < total,
    };
  }
}

export function normalizeEnemHubQuestion(question: EnemHubQuestion) {
  const statementHtml = sanitizeQuestionHtml(question.statement);
  const taxonomyPath = splitTaxonomyPath(question.subject.area);
  const [topic, subtopic, ...remaining] = taxonomyPath;
  return normalizedQuestionBankItemSchema.parse({
    provider: 'ENEMHUB',
    providerQuestionId: question.id,
    externalId: question.externalId ?? null,
    examType: 'ENEM',
    examName: question.exam?.name ?? 'ENEM',
    board: null,
    institution: question.exam?.institution ?? null,
    examYear: question.year ?? null,
    subject: question.subject.name,
    topic,
    subtopic: subtopic ?? null,
    subsubtopic: remaining.length > 0 ? remaining.join(' > ') : null,
    taxonomyPath,
    statementHtml,
    statementText: htmlToPlainText(statementHtml),
    alternatives: question.alternatives.map((alternative) => ({
      providerId: alternative.id ?? null,
      label: alternative.letter,
      text: alternative.text,
      isCorrect: alternative.isCorrect,
    })),
    correctAnswer: question.correctAlternative,
    difficulty: normalizeDifficulty(question.difficulty),
    sourceUrl: `https://api.enemhub.com.br/v1/enem/questions/${question.id}`,
    imageUrls: extractImageUrls(statementHtml),
    rawPayload: question,
    sourceFetchedAt: new Date(),
  });
}
