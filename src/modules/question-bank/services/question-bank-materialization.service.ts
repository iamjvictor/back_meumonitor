import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { NormalizedQuestionBankSelection } from './question-bank-selection.service.js';
import { buildSelectionWhere, normalizeTaxonomyName } from './question-bank-selection.service.js';
import { computeQuestionContentHash, normalizeDifficulty } from './question-bank-content.service.js';

export type MaterializeMonitorQuestionsInput = {
  teacherId: string;
  monitorId: string;
  selections: Array<{
    monitorTopicId: string;
    monitorSubjectId: string;
    monitorSubtopicId?: string | null;
    monitorSubsubtopicId?: string | null;
    selection: NormalizedQuestionBankSelection;
  }>;
};

export type MaterializationResult = {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failures: Array<{ questionBankItemId?: string; reason: string }>;
};

export type QuestionBankMaterializationAlternative = {
  providerId?: string | null;
  label: string;
  text: string;
  isCorrect?: boolean;
};

export type QuestionBankMaterializationItem = {
  id: string;
  provider: string;
  providerQuestionId: string;
  externalId: string | null;
  examType: string;
  examName: string;
  board: string | null;
  institution: string | null;
  examYear: number | null;
  subject: string;
  topic: string;
  subtopic: string | null;
  subsubtopic: string | null;
  taxonomyPath: unknown;
  statementHtml: string;
  statementText: string;
  alternatives: QuestionBankMaterializationAlternative[];
  correctAnswer: string;
  difficulty: string | null;
  sourceUrl: string | null;
  imageUrls: unknown;
  explanation: string | null;
  status: string;
};

export type MaterializedQuestionData = {
  questionBankItemId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId: string;
  subtopicId: string | null;
  subsubtopicId: string | null;
  text: string;
  alternatives: Array<{ label: string; text: string }>;
  kind: 'MULTIPLE_CHOICE';
  statementOrigin: 'EXTERNAL_SOURCE';
  alternativesOrigin: 'EXTERNAL_SOURCE';
  correctAnswer: string;
  correctAnswerOrigin: 'EXTERNAL_SOURCE';
  explanation: string | null;
  explanationOrigin: 'EXTERNAL_SOURCE' | null;
  difficulty: string | null;
  completenessStatus: 'COMPLETE_FROM_SOURCE';
  needsReview: false;
  qualityScore: 1;
  textHash: string;
  sourceKey: string;
  metadata: Record<string, unknown>;
  status: 'APPROVED';
};

export type QuestionBankMaterializationRepository = {
  findItems(selections: NormalizedQuestionBankSelection[]): Promise<QuestionBankMaterializationItem[]>;
  findBySourceKey(sourceKey: string): Promise<{ id: string } | null>;
  upsertQuestion(data: MaterializedQuestionData): Promise<{ id: string; created: boolean }>;
};

class PrismaQuestionBankMaterializationRepository implements QuestionBankMaterializationRepository {
  async findItems(selections: NormalizedQuestionBankSelection[]) {
    const where = selections.map((selection) => buildSelectionWhere(selection));
    if (where.length === 0) return [];

    const items = await prisma.questionBankItem.findMany({
      where: {
        status: { notIn: ['DELETED', 'ARCHIVED'] },
        OR: where,
      },
      orderBy: { id: 'asc' },
    });

    return items as unknown as QuestionBankMaterializationItem[];
  }

  async findBySourceKey(sourceKey: string) {
    return prisma.question.findUnique({ where: { sourceKey }, select: { id: true } });
  }

  async upsertQuestion(data: MaterializedQuestionData) {
    const existing = await this.findBySourceKey(data.sourceKey);
    const databaseData = {
      ...data,
      metadata: data.metadata as Prisma.InputJsonValue,
    };
    const question = await prisma.question.upsert({
      where: { sourceKey: data.sourceKey },
      create: databaseData,
      update: databaseData,
      select: { id: true },
    });
    return { id: question.id, created: !existing };
  }
}

export class QuestionBankMaterializationService {
  private readonly repository: QuestionBankMaterializationRepository;

  constructor(repository: QuestionBankMaterializationRepository = new PrismaQuestionBankMaterializationRepository()) {
    this.repository = repository;
  }

  async materialize(input: MaterializeMonitorQuestionsInput): Promise<MaterializationResult> {
    console.log('Materialização recebida pelo serviço', {
      event: 'question_bank.materialization_input_received',
      monitorId: input.monitorId,
      teacherId: input.teacherId,
      selectionCount: input.selections.length,
      selections: input.selections,
    });

    if (input.selections.length === 0) {
      return { processed: 0, created: 0, updated: 0, skipped: 0, failures: [] };
    }

    const selections = Array.from(
      new Map(input.selections.map((entry) => [entry.selection.selectionKey, entry])).values(),
    );
    let items: QuestionBankMaterializationItem[];
    try {
      items = await this.repository.findItems(selections.map(({ selection }) => selection));
      console.log('Itens do acervo encontrados para materialização', {
        event: 'question_bank.materialization_items_loaded',
        monitorId: input.monitorId,
        selectionCount: selections.length,
        itemCount: items.length,
        itemIds: items.map((item) => item.id),
      });
    } catch (error) {
      console.log('Falha ao consultar itens do acervo', {
        event: 'question_bank.materialization_lookup_failed',
        monitorId: input.monitorId,
        error: error instanceof Error ? error.message : error,
      });
      return {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failures: [{
          reason: error instanceof Error ? `QUESTION_BANK_LOOKUP_FAILED: ${error.message}` : 'QUESTION_BANK_LOOKUP_FAILED',
        }],
      };
    }
    const uniqueItems = new Map(items.map((item) => [item.id, item]));
    const result: MaterializationResult = { processed: 0, created: 0, updated: 0, skipped: 0, failures: [] };

    for (const item of uniqueItems.values()) {
      result.processed += 1;
      const target = selections.find(({ selection }) => matchesSelection(item, selection));
      if (!target) {
        result.skipped += 1;
        result.failures.push({ questionBankItemId: item.id, reason: 'QUESTION_BANK_ITEM_NOT_SELECTED' });
        continue;
      }

      const validationFailure = validateMaterializationItem(item);
      if (validationFailure) {
        console.log('Item do acervo ignorado na materialização', {
          event: 'question_bank.materialization_item_skipped',
          monitorId: input.monitorId,
          questionBankItemId: item.id,
          reason: validationFailure,
          status: item.status,
        });
        result.skipped += 1;
        result.failures.push({ questionBankItemId: item.id, reason: validationFailure });
        continue;
      }

      const data = buildMaterializedQuestionData(input, target, item);
      try {
        const existing = await this.repository.findBySourceKey(data.sourceKey);
        await this.repository.upsertQuestion(data);
        console.log('Questão do acervo materializada', {
          event: 'question_bank.materialization_item_persisted',
          monitorId: input.monitorId,
          questionBankItemId: item.id,
          sourceKey: data.sourceKey,
          topicId: data.topicId,
          subjectId: data.subjectId,
          operation: existing ? 'UPDATED' : 'CREATED',
        });
        if (existing) result.updated += 1;
        else result.created += 1;
      } catch (error) {
        console.log('Falha ao persistir questão do acervo', {
          event: 'question_bank.materialization_item_failed',
          monitorId: input.monitorId,
          questionBankItemId: item.id,
          error: error instanceof Error ? error.message : error,
        });
        result.skipped += 1;
        result.failures.push({
          questionBankItemId: item.id,
          reason: error instanceof Error ? `QUESTION_MATERIALIZATION_FAILED: ${error.message}` : 'QUESTION_MATERIALIZATION_FAILED',
        });
      }
    }

    console.log('Resumo final da materialização', {
      event: 'question_bank.materialization_summary',
      monitorId: input.monitorId,
      result,
    });
    return result;
  }
}

function matchesSelection(item: QuestionBankMaterializationItem, selection: NormalizedQuestionBankSelection) {
  const isGeneralSubtopic = normalizeTaxonomyName(selection.subtopic) === 'geral' && !selection.subsubtopic;
  return item.examType.trim().toUpperCase() === selection.examType
    && normalizeProfile(item.board) === normalizeProfile(selection.board)
    && normalizeTaxonomyName(item.subject) === normalizeTaxonomyName(selection.subject)
    && normalizeTaxonomyName(item.topic) === normalizeTaxonomyName(selection.topic)
    && (selection.subtopic === null
      || (isGeneralSubtopic ? item.subtopic === null : normalizeTaxonomyName(item.subtopic) === normalizeTaxonomyName(selection.subtopic)))
    && (selection.subsubtopic === null || normalizeTaxonomyName(item.subsubtopic) === normalizeTaxonomyName(selection.subsubtopic));
}

function normalizeProfile(value: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toUpperCase() ?? null;
}

function validateMaterializationItem(item: QuestionBankMaterializationItem): string | null {
  if (!['IMPORTED', 'ACTIVE'].includes(item.status)) return 'QUESTION_BANK_ITEM_NOT_ACTIVE';
  if (!item.statementText.trim()) return 'QUESTION_BANK_ITEM_MISSING_STATEMENT';
  if (!Array.isArray(item.alternatives) || item.alternatives.length < 2) return 'QUESTION_BANK_ITEM_INVALID_ALTERNATIVES';

  const alternatives = item.alternatives.filter((alternative) => alternative.label?.trim() && alternative.text?.trim());
  if (alternatives.length !== item.alternatives.length) return 'QUESTION_BANK_ITEM_INVALID_ALTERNATIVES';

  const correct = alternatives.filter((alternative) => alternative.isCorrect === true);
  if (correct.length !== 1 || correct[0]?.label.trim().toUpperCase() !== item.correctAnswer.trim().toUpperCase()) {
    return 'QUESTION_BANK_ITEM_INVALID_CORRECT_ANSWER';
  }

  return null;
}

function buildMaterializedQuestionData(
  input: MaterializeMonitorQuestionsInput,
  target: MaterializeMonitorQuestionsInput['selections'][number],
  item: QuestionBankMaterializationItem,
): MaterializedQuestionData {
  const alternatives = item.alternatives.map(({ label, text }) => ({ label: label.trim(), text: text.trim() }));
  const sourceKey = `question-bank:${input.monitorId}:${item.id}`;
  const text = item.statementText.trim();

  return {
    questionBankItemId: item.id,
    teacherId: input.teacherId,
    monitorId: input.monitorId,
    subjectId: target.monitorSubjectId,
    topicId: target.monitorTopicId,
    subtopicId: target.monitorSubtopicId ?? null,
    subsubtopicId: target.monitorSubsubtopicId ?? null,
    text,
    alternatives,
    kind: 'MULTIPLE_CHOICE',
    statementOrigin: 'EXTERNAL_SOURCE',
    alternativesOrigin: 'EXTERNAL_SOURCE',
    correctAnswer: item.correctAnswer.trim().toUpperCase(),
    correctAnswerOrigin: 'EXTERNAL_SOURCE',
    explanation: item.explanation?.trim() || null,
    explanationOrigin: item.explanation?.trim() ? 'EXTERNAL_SOURCE' : null,
    difficulty: normalizeDifficulty(item.difficulty),
    completenessStatus: 'COMPLETE_FROM_SOURCE',
    needsReview: false,
    qualityScore: 1,
    textHash: computeQuestionContentHash({
      provider: item.provider,
      providerQuestionId: item.providerQuestionId,
      subject: item.subject,
      topic: item.topic,
      statementText: text,
      alternatives,
      correctAnswer: item.correctAnswer.trim().toUpperCase(),
    }),
    sourceKey,
    metadata: {
      source: 'QUESTION_BANK',
      questionBankItemId: item.id,
      provider: item.provider,
      providerQuestionId: item.providerQuestionId,
      externalId: item.externalId,
      examType: item.examType,
      examName: item.examName,
      board: item.board,
      institution: item.institution,
      examYear: item.examYear,
      subject: item.subject,
      topic: item.topic,
      subtopic: item.subtopic,
      subsubtopic: item.subsubtopic,
      taxonomyPath: item.taxonomyPath,
      statementHtml: item.statementHtml,
      sourceUrl: item.sourceUrl,
      imageUrls: item.imageUrls,
    },
    status: 'APPROVED',
  };
}
