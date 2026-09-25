import type {
  NormalizedQuestionBankItem,
  QuestionBankProvider,
} from '../models/question-bank.model.js';

export type QuestionBankPersistenceResult = {
  id: string;
  created: boolean;
};

export type QuestionBankPersistencePort = {
  upsert(value: NormalizedQuestionBankItem): Promise<QuestionBankPersistenceResult>;
  findByProviderQuestionId(provider: QuestionBankProvider, providerQuestionId: string): Promise<unknown | null>;
  countByProvider(provider: QuestionBankProvider): Promise<number>;
  listImportFailures(provider: QuestionBankProvider, limit: number): Promise<unknown[]>;
};

export class QuestionBankRepository {
  constructor(private readonly persistence: QuestionBankPersistencePort) {}

  upsertNormalized(value: NormalizedQuestionBankItem) {
    return this.persistence.upsert(value);
  }

  findByProviderQuestionId(provider: QuestionBankProvider, providerQuestionId: string) {
    return this.persistence.findByProviderQuestionId(provider, providerQuestionId);
  }

  countByProvider(provider: QuestionBankProvider) {
    return this.persistence.countByProvider(provider);
  }

  listImportFailures(provider: QuestionBankProvider, limit: number) {
    return this.persistence.listImportFailures(provider, limit);
  }
}
