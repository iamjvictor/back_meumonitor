import type { Prisma } from '@prisma/client';
import type {
  NormalizedQuestionBankItem,
  QuestionBankProvider,
} from '../models/question-bank.model.js';
import { computeQuestionContentHash } from '../services/question-bank-content.service.js';
import type {
  QuestionBankPersistencePort,
  QuestionBankPersistenceResult,
} from './question-bank.repository.js';

type QuestionBankRecord = {
  id: string;
  createdAt?: Date;
};

export type QuestionBankItemDelegate = {
  findUnique(args: { where: { provider_providerQuestionId: { provider: string; providerQuestionId: string } } }): Promise<QuestionBankRecord | null>;
  upsert(args: { where: { provider_providerQuestionId: { provider: string; providerQuestionId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<QuestionBankRecord>;
  count(args: { where: { provider: string } }): Promise<number>;
  findMany(args: { where: { provider: string; status: string }; take: number; orderBy: { updatedAt: 'desc' } }): Promise<unknown[]>;
};

export class PrismaQuestionBankPersistence implements QuestionBankPersistencePort {
  constructor(private readonly delegate: QuestionBankItemDelegate) {}

  async upsert(value: NormalizedQuestionBankItem): Promise<QuestionBankPersistenceResult> {
    const where = {
      provider_providerQuestionId: {
        provider: value.provider,
        providerQuestionId: value.providerQuestionId,
      },
    };
    const existing = await this.delegate.findUnique({ where });
    const data = this.toDatabaseData(value);
    const record = await this.delegate.upsert({ where, create: data, update: data });
    return { id: record.id, created: existing === null };
  }

  findByProviderQuestionId(provider: QuestionBankProvider, providerQuestionId: string) {
    return this.delegate.findUnique({
      where: { provider_providerQuestionId: { provider, providerQuestionId } },
    });
  }

  countByProvider(provider: QuestionBankProvider) {
    return this.delegate.count({ where: { provider } });
  }

  listImportFailures(provider: QuestionBankProvider, limit: number) {
    return this.delegate.findMany({
      where: { provider, status: 'REJECTED' },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private toDatabaseData(value: NormalizedQuestionBankItem): Record<string, unknown> {
    return {
      provider: value.provider,
      providerQuestionId: value.providerQuestionId,
      externalId: value.externalId,
      examType: value.examType,
      examName: value.examName,
      board: value.board,
      institution: value.institution,
      examYear: value.examYear,
      subject: value.subject,
      topic: value.topic,
      subtopic: value.subtopic,
      subsubtopic: value.subsubtopic,
      taxonomyPath: value.taxonomyPath as Prisma.InputJsonValue,
      statementHtml: value.statementHtml,
      statementText: value.statementText,
      alternatives: value.alternatives as unknown as Prisma.InputJsonValue,
      correctAnswer: value.correctAnswer,
      difficulty: value.difficulty,
      sourceUrl: value.sourceUrl,
      imageUrls: value.imageUrls as Prisma.InputJsonValue,
      rawPayload: value.rawPayload as Prisma.InputJsonValue,
      contentHash: this.contentHash(value),
      sourceFetchedAt: value.sourceFetchedAt,
    };
  }

  private contentHash(value: NormalizedQuestionBankItem) {
    return computeQuestionContentHash({
      provider: value.provider,
      providerQuestionId: value.providerQuestionId,
      subject: value.subject,
      topic: value.topic,
      statementText: value.statementText,
      alternatives: value.alternatives.map(({ label, text }) => ({ label, text })),
      correctAnswer: value.correctAnswer,
    });
  }
}
