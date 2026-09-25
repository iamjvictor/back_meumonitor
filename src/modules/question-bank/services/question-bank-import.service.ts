import type { NormalizedProviderPage, ProviderPageInput } from '../models/question-bank.model.js';
import { QuestionBankRepository } from '../repositories/question-bank.repository.js';

export type QuestionBankPageAdapter = {
  fetchPage(input: ProviderPageInput): Promise<NormalizedProviderPage>;
};

export type QuestionBankImportResult = {
  pagesProcessed: number;
  itemsReceived: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsRejected: number;
  lastPage: number;
};

export async function importQuestionBankPages(input: {
  adapter: QuestionBankPageAdapter;
  repository: QuestionBankRepository;
  pageSize?: number;
  year?: number;
  subjectId?: string;
  maxPages?: number;
  onPage?: (result: QuestionBankImportResult) => void;
}): Promise<QuestionBankImportResult> {
  const pageSize = input.pageSize ?? 100;
  const result: QuestionBankImportResult = {
    pagesProcessed: 0,
    itemsReceived: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsRejected: 0,
    lastPage: 0,
  };

  for (let page = 1; input.maxPages === undefined || page <= input.maxPages; page += 1) {
    const response = await input.adapter.fetchPage({ page, pageSize, year: input.year, subjectId: input.subjectId });
    result.pagesProcessed += 1;
    result.lastPage = page;
    result.itemsReceived += response.items.length;
    for (const item of response.items) {
      try {
        const persisted = await input.repository.upsertNormalized(item);
        if (persisted.created) result.itemsCreated += 1;
        else result.itemsUpdated += 1;
      } catch {
        result.itemsRejected += 1;
      }
    }
    input.onPage?.(result);
    if (!response.hasNextPage || response.items.length === 0) break;
  }
  return result;
}
