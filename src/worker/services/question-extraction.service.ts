import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { aiModels } from '../../config/ai-models.config.js';
import { StructuredCompletionError } from '../client/openrouter.client.js';
import { OpenRouterClient } from '../client/openrouter.client.js';
import { QuestionCompletionService } from './completeQuestion/question-completion.service.js';
import type { CompletionGeneration, QuestionAgentFailure } from './completeQuestion/question-completion.types.js';
import { QuestionCategoryAgentService } from './completeQuestion/question-category-agent.service.js';
import { appendProcessingTimeReport, formatDuration } from './processing-time-report.service.js';
import {
  alternativesOnlyJsonSchema,
  alternativesOnlyZodSchema,
  answerOnlyJsonSchema,
  answerOnlyZodSchema,
  explanationOnlyJsonSchema,
  explanationOnlyZodSchema,
  questionCompletionJsonSchema,
  questionCompletionZodSchema,
} from '../schemas/question-completion.schema.js';
import {
  findPendingQuestionForCompletion,
  findQuestionContext,
  findQuestionExtractionData,
  saveQuestion,
} from '../../repositories/question.repository.js';

const CHUNKS_PER_GROUP = 3;
const MAX_PARALLEL_GROUPS = 3;
const MAX_INPUT_CHARS = 200_000;
const MAX_RETRIES = 3;
const QUESTION_EMBEDDING_VERSION = 'question-text-v1';
const QUESTION_ENRICHMENT_PROMPT_VERSION = 'question-completion-v1';

type CompletionTask = 'ANSWER_ONLY' | 'EXPLANATION_ONLY' | 'ALTERNATIVES_ONLY' | 'FULL_COMPLETION';

class AsyncSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async run<T>(operation: () => Promise<T>) {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.available += 1;
  }
}

// All document jobs in this worker share this gate. LLM work remains concurrent,
// but short Prisma write transactions are serialized to protect the connection pool.
const questionPersistenceSemaphore = new AsyncSemaphore(1);

export type ExtractionChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  blockId?: string | null;
  content: string;
  charStart?: number | null;
  charEnd?: number | null;
  block?: { pageStart: number | null; pageEnd: number | null } | null;
};

export type QuestionTopicInput = {
  id: string;
  name: string;
  index: number;
  definition?: string | null;
  classificationGuidance?: string | null;
  aiDefinition?: string | null;
  aiClassificationGuidance?: string | null;
};

type QuestionSourceDraft = {
  chunkId: string;
  documentId: string;
  documentBlockId: string | null;
  role: 'STATEMENT' | 'ALTERNATIVE' | 'ANSWER_KEY' | 'EXPLANATION';
  pageStart: number | null;
  pageEnd: number | null;
  charStartInChunk: number | null;
  charEndInChunk: number | null;
  excerpt: string;
  confidence: number;
};

type CandidateCompletion = {
  candidate: z.infer<typeof extractedQuestionSchema>;
  usedAi: boolean;
  generatedAlternatives: boolean;
  generatedCorrectAnswer: boolean;
  generatedExplanation: boolean;
  confidence: number;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  generationType?: 'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION' | 'FULL_ENRICHMENT';
  completionTask?: CompletionTask;
  completionError?: { code: string; finishReason?: string | null };
  generations?: CompletionGeneration[];
  answerUsedDocumentRag?: boolean;
  answerDecisionSource?: 'SOURCE_DOCUMENT' | 'DOCUMENT_RAG' | 'MODEL_INFERENCE' | null;
  completionFailedAgents?: Array<'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION'>;
  completionFailures?: QuestionAgentFailure[];
  missingFields: string[];
  completenessStatus: 'COMPLETE_FROM_SOURCE' | 'COMPLETE_WITH_AI' | 'MISSING_ALTERNATIVES' | 'MISSING_ANSWER' | 'MISSING_EXPLANATION';
};

const alternativeSchema = z.object({
  label: z.string(),
  text: z.string().min(1),
});

const relatedTopicSchema = z.object({
  topicId: z.string().uuid(),
  confidence: z.number().min(0).max(1),
});

const optionalSourceChunkIndexesSchema = z.preprocess(
  (value) => value === null ? [] : value,
  z.array(z.number().int().nonnegative()).optional(),
);

const extractedQuestionSchema = z.object({
  text: z.string().min(10),
  kind: z.enum(['OPEN_ENDED', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'UNKNOWN']),
  alternatives: z.array(alternativeSchema),
  correctAnswer: z.string().nullable(),
  explanation: z.string().nullable(),
  topicId: z.string().nullable().default(null),
  relatedTopics: z.array(relatedTopicSchema).default([]),
  sourceChunkIndexes: z.array(z.number().int().nonnegative()).min(1),
  answerSourceChunkIndexes: optionalSourceChunkIndexesSchema,
  explanationSourceChunkIndexes: optionalSourceChunkIndexesSchema,
  sourceBlockId: z.string().uuid().nullable().optional(),
  questionNumber: z.string().nullable().optional(),
});

const llmResponseSchema = z.object({
  questions: z.array(extractedQuestionSchema),
});

export type ExtractedQuestion = z.infer<typeof extractedQuestionSchema> & {
  id: string;
  source: {
    knowledgeBaseId: string;
    chunkIds: string[];
    chunkIndexes: number[];
  };
};

export type QuestionExtractionOutput = {
  questions: ExtractedQuestion[];
  metadata: {
    chunksProcessed: number;
    groupsProcessed: number;
    groupsFailed: number;
    questionsExtracted: number;
    questionsSaved: number;
    duplicatesSkipped: number;
    invalidTopicsSkipped: number;
  };
};

const QUESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['OPEN_ENDED', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'UNKNOWN'] },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { label: { type: 'string' }, text: { type: 'string' } },
              required: ['label', 'text'],
            },
          },
          correctAnswer: { type: ['string', 'null'] },
          explanation: { type: ['string', 'null'] },
          sourceChunkIndexes: { type: 'array', items: { type: 'integer' }, minItems: 1 },
          answerSourceChunkIndexes: { type: 'array', items: { type: 'integer' } },
          explanationSourceChunkIndexes: { type: 'array', items: { type: 'integer' } },
          sourceBlockId: { type: ['string', 'null'] },
          questionNumber: { type: ['string', 'null'] },
        },
        required: [
          'text',
          'kind',
          'alternatives',
          'correctAnswer',
          'explanation',
          'sourceChunkIndexes',
        ],
      },
    },
  },
  required: ['questions'],
};

export class QuestionExtractionService {
  private readonly candidateStartedAt = new WeakMap<object, number>();

  constructor(
    private readonly client = new OpenRouterClient(),
    private readonly completionService = new QuestionCompletionService(),
    private readonly categoryAgent = new QuestionCategoryAgentService(),
  ) {}

  async processDocument(documentId: string) {
    const startedAt = Date.now();
    console.log('Agente de questoes acionado pelo processamento do documento', {
      event: 'monitor.question_extraction_document_started',
      documentId,
    });

    const data = await findQuestionExtractionData(documentId);
    if (!data) {
      console.log('Analise de questoes ignorada: documento nao encontrado', {
        event: 'monitor.question_extraction_document_missing',
        documentId,
      });
      return [];
    }

    console.log('Dados carregados para analise de questoes', {
      event: 'monitor.question_extraction_data_loaded',
      documentId,
      readyChunkCount: data.chunks.length,
      topicCount: data.topicLinks.length,
      topicIds: data.topicLinks.map((link) => link.topic.id),
    });

    if (data.chunks.length === 0) {
      console.log('Analise de questoes ignorada: nenhum chunk READY', {
        event: 'monitor.question_extraction_no_ready_chunks',
        documentId,
      });
      return [];
    }

    if (data.topicLinks.length === 0) {
      console.log('Analise de questoes ignorada: nenhuma categoria cadastrada', {
        event: 'monitor.question_extraction_no_categories',
        documentId,
        topicIds: [],
      });
      return [];
    }

    const topicCandidates = data.topicLinks.map(({ topic }, index) => ({ ...topic, index }));
    const fixedTopicId = data.topicId;
    console.log('Preparando analise com os topicos como categorias', {
      event: 'monitor.question_extraction_topics_as_categories',
      documentId,
      topicCount: topicCandidates.length,
      topics: topicCandidates,
    });

    const explicitBlocks = data.blocks.filter((block) => block.type === 'QUESTION');
    if (explicitBlocks.length > 0) {
      const deterministicCandidates = extractQuestionsFromBlocks(data.blocks, data.chunks);
      console.log('Questoes explicitas extraidas por parser deterministico', {
        event: 'monitor.question_deterministic_extraction_completed',
        documentId,
        blockCount: explicitBlocks.length,
        candidateCount: deterministicCandidates.length,
      });

      const output = await this.persistCandidates(
        deterministicCandidates,
        data.chunks,
        topicCandidates,
        topicCandidates[0]!.id,
        documentId,
        { groupsProcessed: 0, groupsFailed: 0 },
        fixedTopicId,
      );

      const fallbackChunks = data.chunks.filter((chunk) => (
        chunk.blockId !== null
        && data.blocks.some((block) => block.id === chunk.blockId && isFallbackQuestionBlock(block.type, block.normalizedContent))
      ));
      if (fallbackChunks.length > 0) {
        const fallbackOutput = await this.extractQuestionsFromChunks(
          fallbackChunks,
          topicCandidates,
          topicCandidates[0]!.id,
          documentId,
          fixedTopicId,
        );
        output.questions.push(...fallbackOutput.questions);
        output.metadata.groupsProcessed += fallbackOutput.metadata.groupsProcessed;
        output.metadata.groupsFailed += fallbackOutput.metadata.groupsFailed;
        output.metadata.questionsExtracted += fallbackOutput.metadata.questionsExtracted;
        output.metadata.questionsSaved += fallbackOutput.metadata.questionsSaved;
        output.metadata.duplicatesSkipped += fallbackOutput.metadata.duplicatesSkipped;
        output.metadata.invalidTopicsSkipped += fallbackOutput.metadata.invalidTopicsSkipped;
      }

      console.log('Agente de questoes finalizou o documento', {
        event: 'monitor.question_extraction_document_completed',
        documentId,
        extractionMethod: 'DETERMINISTIC',
        ...output.metadata,
        durationMs: Date.now() - startedAt,
      });
      return output;
    }

    const fallbackBlockIds = new Set(
      data.blocks
        .filter((block) => isFallbackQuestionBlock(block.type, block.normalizedContent))
        .map((block) => block.id),
    );
    const fallbackChunks = data.chunks.filter((chunk) => chunk.blockId !== null && fallbackBlockIds.has(chunk.blockId));
    if (fallbackChunks.length === 0) {
      console.log('Analise de questoes ignorada: nenhum exercicio explicito em bloco elegivel', {
        event: 'monitor.question_extraction_no_explicit_exercises',
        documentId,
      });
      return [];
    }

    const results = [
      await this.extractQuestionsFromChunks(fallbackChunks, topicCandidates, topicCandidates[0]!.id, documentId, fixedTopicId),
    ];

    console.log('Agente de questoes finalizou o documento', {
      event: 'monitor.question_extraction_document_completed',
      documentId,
      topicResults: results.length,
      questionsSaved: results.reduce((total, result) => total + result.metadata.questionsSaved, 0),
      durationMs: Date.now() - startedAt,
    });

    return results;
  }

  async extractQuestionsFromChunks(
    chunks: ExtractionChunk[],
    categories: QuestionTopicInput[],
    topicId: string,
    knowledgeBaseId: string,
    fixedTopicId: string | null = null,
  ): Promise<QuestionExtractionOutput> {
    const startedAt = Date.now();
    const context = await findQuestionContext(topicId);
    if (!context) throw new Error(`Topico ${topicId} nao encontrado.`);

    const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
    const groups = groupChunks(orderedChunks, CHUNKS_PER_GROUP);
    const topicMap = new Map(categories.map((topic) => [topic.id, topic]));

    console.log('Extracao de questoes iniciada', {
      event: 'monitor.question_extraction_started',
      topicId,
      knowledgeBaseId,
      chunksProcessed: orderedChunks.length,
      groupCount: groups.length,
      topicsCount: categories.length,
      concurrency: MAX_PARALLEL_GROUPS,
    });

    let groupsFailed = 0;
    const groupResults = await mapWithConcurrency(groups, MAX_PARALLEL_GROUPS, async (group, index) => {
      try {
        return await this.extractGroupWithRetry(group, categories, index + 1, knowledgeBaseId);
      } catch (error) {
        groupsFailed += 1;
        console.log('Grupo de chunks falhou; demais grupos continuarao', {
          event: 'monitor.question_group_failed_non_blocking',
          documentId: knowledgeBaseId,
          groupNumber: index + 1,
          chunkIndexes: group.map((chunk) => chunk.chunkIndex),
          error,
        });
        return [];
      }
    });

    const candidates = groupResults.flatMap((result) => result);
    console.log('Candidatas recebidas do LLM', {
      event: 'monitor.question_extraction_candidates_received',
      candidateCount: candidates.length,
    });
    const output = await this.persistCandidates(
      candidates,
      orderedChunks,
      categories,
      topicId,
      knowledgeBaseId,
      { groupsProcessed: groups.length, groupsFailed },
      fixedTopicId,
    );

    console.log('Extracao de questoes concluida', {
      event: 'monitor.question_extraction_completed',
      topicId,
      knowledgeBaseId,
      ...output.metadata,
      durationMs: Date.now() - startedAt,
    });

    return output;
  }

  private async persistCandidates(
    candidates: Array<z.infer<typeof extractedQuestionSchema>>,
    orderedChunks: ExtractionChunk[],
    categories: QuestionTopicInput[],
    fallbackTopicId: string,
    knowledgeBaseId: string,
    groupMetadata: { groupsProcessed: number; groupsFailed: number },
    fixedTopicId: string | null = null,
  ): Promise<QuestionExtractionOutput> {
    const context = await findQuestionContext(fallbackTopicId);
    if (!context) throw new Error(`Topico ${fallbackTopicId} nao encontrado.`);
    const topicMap = new Map(categories.map((topic) => [topic.id, topic]));
    let duplicatesSkipped = 0;
    let invalidTopicsSkipped = 0;
    const savedQuestions: ExtractedQuestion[] = [];
    const candidateEmbeddings = await this.generateQuestionEmbeddings(candidates);

    console.log('Persistindo candidatas com concorrencia controlada', {
      event: 'monitor.question_candidates_persistence_started',
      documentId: knowledgeBaseId,
      candidateCount: candidates.length,
      llmConcurrency: aiModels.questionCandidateConcurrency,
      persistenceConcurrency: 1,
    });

    await mapWithConcurrency(candidates, aiModels.questionCandidateConcurrency, async (candidate, index) => {
      const questionStartedAt = this.candidateStartedAt.get(candidate) ?? Date.now();
      const questionLabel = candidate.questionNumber ?? `candidata-${index + 1}`;
      const reportQuestionResult = async (result: string, questionId?: string | null) => {
        await appendProcessingTimeReport([
          `### Questao ${questionLabel}`,
          `- Documento ID: \`${knowledgeBaseId}\``,
          `- Source block: \`${candidate.sourceBlockId ?? 'n/a'}\``,
          `- Chunks: ${candidate.sourceChunkIndexes.join(', ')}`,
          `- Resultado: ${result}`,
          `- Medicao iniciada: ${this.candidateStartedAt.has(candidate) ? 'antes da extracao no LLM' : 'inicio da persistencia deterministica'}`,
          questionId ? `- Question ID: \`${questionId}\`` : null,
          `- Tempo da candidata: ${formatDuration(Date.now() - questionStartedAt)}`,
          `- Registrado em: ${new Date().toISOString()}`,
        ].filter(Boolean).join('\n'));
      };

      if (!isPlausibleQuestionCandidate(candidate)) {
        console.log('Questao ignorada: candidata parece fragmento, formula ou alternativa isolada', {
          event: 'monitor.question_invalid_fragment_skipped',
          sourceBlockId: candidate.sourceBlockId ?? null,
          sourceChunkIndexes: candidate.sourceChunkIndexes,
          textPreview: candidate.text.slice(0, 120),
        });
        await reportQuestionResult('DESCARTADA: fragmento invalido');
        return;
      }
      const normalizedText = normalizeQuestionText(candidate.text);
      const textHash = createHash('sha256').update(normalizedText).digest('hex');
      let questionTopicId = candidate.topicId && topicMap.has(candidate.topicId)
        ? candidate.topicId
        : null;
      let relatedTopics = candidate.relatedTopics.filter(({ topicId, confidence }) => (
        topicMap.has(topicId) && topicId !== questionTopicId && confidence > 0.5
      ));
      let topicClassificationPending = !questionTopicId;
      if (topicClassificationPending) {
        console.log('Questao sem topico principal sera salva para revisao', {
          event: 'monitor.question_topic_pending_review',
          fallbackTopicId,
          candidateTopicId: candidate.topicId,
          sourceBlockId: candidate.sourceBlockId ?? null,
          sourceChunkIndexes: candidate.sourceChunkIndexes,
        });
      }

      const sourceChunks = orderedChunks.filter((chunk) => candidate.sourceChunkIndexes.includes(chunk.chunkIndex));
      const answerSourceChunks = orderedChunks.filter((chunk) => candidate.answerSourceChunkIndexes?.includes(chunk.chunkIndex));
      const explanationSourceChunks = orderedChunks.filter((chunk) => candidate.explanationSourceChunkIndexes?.includes(chunk.chunkIndex));
      if (sourceChunks.length === 0) {
        await reportQuestionResult('DESCARTADA: nenhum chunk de origem encontrado');
        return;
      }
      const sourceBlockId = candidate.sourceBlockId ?? sourceChunks.find((chunk) => chunk.blockId)?.blockId ?? null;
      const sourceKey = buildQuestionSourceKey({
        documentId: sourceChunks[0]!.documentId,
        sourceBlockId,
        questionNumber: candidate.questionNumber ?? null,
        statement: normalizedText,
      });
      const existingQuestion = await findPendingQuestionForCompletion(sourceKey);

      const embedding = candidateEmbeddings[index];

      const candidateForCompletion = existingQuestion
        ? mergeExistingQuestionFields(candidate, existingQuestion)
        : candidate;
      const completed = await this.completeQuestionCandidate(candidateForCompletion, sourceChunks);
      const completedCandidate = completed.candidate;
      const completenessStatus = completed.completenessStatus;
      const categoryResult = fixedTopicId
        ? { classification: null, failure: undefined }
        : await this.categoryAgent.classify({
            statement: completedCandidate.text,
            alternatives: completedCandidate.alternatives,
            allowedTopics: categories,
          });
      const categoryClassification = categoryResult.classification;
      if (fixedTopicId) {
        questionTopicId = fixedTopicId;
        relatedTopics = [];
        topicClassificationPending = false;
      }
      if (categoryClassification) {
        questionTopicId = categoryClassification.primaryTopicId;
        relatedTopics = categoryClassification.relatedTopics;
        topicClassificationPending = false;
      }
      if (topicClassificationPending) {
        console.log('Classificacao especializada de topico falhou; questao seguira sem topico para revisao', {
          event: 'monitor.question_category_agent_failed_non_blocking',
          sourceBlockId,
          sourceChunkIndexes: candidate.sourceChunkIndexes,
          categoryFailure: categoryResult.failure ?? null,
        });
      }
      const alternativesOrigin = completedCandidate.alternatives.length > 0
        ? (completed.generatedAlternatives ? 'AI_GENERATED' as const : 'SOURCE_DOCUMENT' as const)
        : undefined;
      const answerOrigin = completed.generatedCorrectAnswer ? 'AI_GENERATED' as const : 'SOURCE_DOCUMENT' as const;
      const explanationOrigin = completed.generatedExplanation ? 'AI_GENERATED' as const : 'SOURCE_DOCUMENT' as const;
      const sources: QuestionSourceDraft[] = sourceChunks.map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentBlockId: chunk.blockId ?? sourceBlockId ?? null,
        role: 'STATEMENT',
        pageStart: chunk.block?.pageStart ?? null,
        pageEnd: chunk.block?.pageEnd ?? null,
        charStartInChunk: chunk.charStart ?? null,
        charEndInChunk: chunk.charEnd ?? null,
        excerpt: chunk.content,
        confidence: sourceBlockId ? 0.95 : 0.7,
      }));
      if (!completed.generatedAlternatives && completedCandidate.alternatives.length > 0) {
        sources.push(...sourceChunks.map((chunk) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentBlockId: chunk.blockId ?? sourceBlockId ?? null,
          role: 'ALTERNATIVE' as const,
          pageStart: chunk.block?.pageStart ?? null,
          pageEnd: chunk.block?.pageEnd ?? null,
          charStartInChunk: chunk.charStart ?? null,
          charEndInChunk: chunk.charEnd ?? null,
          excerpt: completedCandidate.alternatives.map((alternative) => `${alternative.label}) ${alternative.text}`).join(' '),
          confidence: sourceBlockId ? 0.95 : 0.7,
        })));
      }
      if (!completed.generatedCorrectAnswer && completedCandidate.correctAnswer) {
        sources.push(...(answerSourceChunks.length > 0 ? answerSourceChunks : sourceChunks).map((chunk) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentBlockId: chunk.blockId ?? sourceBlockId ?? null,
          role: 'ANSWER_KEY' as const,
          pageStart: chunk.block?.pageStart ?? null,
          pageEnd: chunk.block?.pageEnd ?? null,
          charStartInChunk: null,
          charEndInChunk: null,
          excerpt: completedCandidate.correctAnswer ?? '',
          confidence: 0.8,
        })));
      }
      if (!completed.generatedExplanation && explanationSourceChunks.length > 0) {
        sources.push(...explanationSourceChunks.map((chunk) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentBlockId: chunk.blockId ?? null,
          role: 'EXPLANATION' as const,
          pageStart: chunk.block?.pageStart ?? null,
          pageEnd: chunk.block?.pageEnd ?? null,
          charStartInChunk: chunk.charStart ?? null,
          charEndInChunk: chunk.charEnd ?? null,
          excerpt: chunk.content,
          confidence: 0.95,
        })));
      }
      const questionContext = !questionTopicId || questionTopicId === fallbackTopicId
        ? context
        : await findQuestionContext(questionTopicId);
      if (!questionContext) {
        await reportQuestionResult('DESCARTADA: contexto do topico nao encontrado');
        return;
      }
      const resolvedQuestionContext = questionContext;

      const question = await questionPersistenceSemaphore.run(() => saveQuestion({
        teacherId: resolvedQuestionContext.subject.monitor.teacherId,
        monitorId: resolvedQuestionContext.subject.monitorId,
        subjectId: resolvedQuestionContext.subjectId,
        topicId: questionTopicId,
        relatedTopics: questionTopicId ? relatedTopics : [],
        text: candidate.text,
        kind: completedCandidate.kind,
        alternatives: completedCandidate.alternatives,
        correctAnswer: completedCandidate.correctAnswer,
        correctAnswerOrigin: completedCandidate.correctAnswer ? answerOrigin : undefined,
        correctAnswerConfidence: completed.generatedCorrectAnswer ? completed.confidence : 0.95,
        explanation: completedCandidate.explanation,
        explanationOrigin: completedCandidate.explanation ? explanationOrigin : undefined,
        explanationConfidence: completed.generatedExplanation ? completed.confidence : 0.9,
        alternativesOrigin,
        statementConfidence: sourceBlockId ? 0.95 : 0.7,
        statementOrigin: sourceBlockId ? 'SOURCE_DOCUMENT' : 'RECONSTRUCTED_FROM_DOCUMENT',
        completenessStatus,
        qualityScore: calculateQualityScore(completedCandidate, completenessStatus),
        needsReview: true,
        metadata: {
          extractionMethod: candidate.sourceBlockId ? 'DETERMINISTIC' : 'LLM',
          completionMethod: completed.usedAi ? 'AI_GENERATED' : 'SOURCE_DOCUMENT',
          completionStatus: completed.missingFields.length > 0
            ? 'PARTIAL_FAILED'
            : completed.usedAi ? 'SUCCESS' : 'NOT_REQUIRED',
          completionFailedAgents: completed.completionFailedAgents ?? [],
          completionFailures: completed.completionFailures ?? [],
          answerUsedDocumentRag: completed.answerUsedDocumentRag ?? false,
          answerDecisionSource: completed.answerDecisionSource ?? null,
          questionNumber: candidate.questionNumber ?? null,
          topicClassification: topicClassificationPending ? 'PENDING_REVIEW' : 'CLASSIFIED',
          topicClassificationFailure: topicClassificationPending,
          topicClassificationFailureReason: topicClassificationPending
            ? categoryResult.failure ?? { code: 'NO_PRIMARY_TOPIC' }
            : null,
          topicClassificationAgentFailure: categoryResult.failure ?? null,
          topicClassificationMethod: fixedTopicId
            ? 'UPLOAD_TOPIC'
            : categoryClassification ? 'QUESTION_CATEGORY_AGENT' : 'SOURCE_OR_BLOCK',
          missingFields: completed.missingFields,
        },
        textHash,
        sourceKey,
        sourceChunkIds: sourceChunks.map((chunk) => chunk.id),
        sources,
        aiGenerations: [...(completed.generations ?? []), ...(categoryClassification ? [categoryClassification.generation] : [])].length > 0
          ? [...(completed.generations ?? []), ...(categoryClassification ? [categoryClassification.generation] : [])].map((generation) => ({
            generationType: generation.generationType,
            model: generation.model,
            promptVersion: QUESTION_ENRICHMENT_PROMPT_VERSION,
            inputSnapshot: generation.inputSnapshot as Prisma.InputJsonValue,
            outputSnapshot: generation.outputSnapshot as Prisma.InputJsonValue,
            confidence: generation.confidence,
          }))
          : undefined,
        embedding,
        embeddingModel: embedding ? env.OPENROUTER_EMBEDDING_MODEL : undefined,
        embeddingVersion: embedding ? QUESTION_EMBEDDING_VERSION : undefined,
      }));
      savedQuestions.push({ ...completedCandidate, id: question.id, source: {
        knowledgeBaseId,
        chunkIds: sourceChunks.map((chunk) => chunk.id),
        chunkIndexes: sourceChunks.map((chunk) => chunk.chunkIndex),
      } });
      console.log('Questao salva para revisao', {
        event: 'monitor.question_saved',
        questionId: question.id,
        topicId: questionTopicId,
        kind: completedCandidate.kind,
        hasCorrectAnswer: Boolean(completedCandidate.correctAnswer),
        hasExplanation: Boolean(completedCandidate.explanation),
        missingFields: completed.missingFields,
        usedAiCompletion: completed.usedAi,
      });
      await reportQuestionResult(
        completed.missingFields.length > 0 ? 'SALVA: pendente de revisao' : 'SALVA: completa',
        question.id,
      );
    });

    return {
      questions: savedQuestions,
      metadata: {
        chunksProcessed: orderedChunks.length,
        groupsProcessed: groupMetadata.groupsProcessed,
        groupsFailed: groupMetadata.groupsFailed,
        questionsExtracted: candidates.length,
        questionsSaved: savedQuestions.length,
        duplicatesSkipped,
        invalidTopicsSkipped,
      },
    };
  }

  private async extractGroupWithRetry(
    group: ExtractionChunk[],
    categories: QuestionTopicInput[],
    groupNumber: number,
    documentId: string,
  ) {
    const extractionStartedAt = Date.now();
    const text = group
      .map((chunk) => `[chunkIndex=${chunk.chunkIndex}]\n${chunk.content}`)
      .join('\n\n--- PROXIMO CHUNK ---\n\n')
      .slice(0, MAX_INPUT_CHARS);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        console.log('Chamando LLM para extrair grupo de chunks', {
          event: 'monitor.question_llm_group_started',
          documentId,
          groupNumber,
          attempt,
          chunkIndexes: group.map((chunk) => chunk.chunkIndex),
          inputChars: text.length,
        });

        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: 'question_extraction',
          schema: QUESTION_SCHEMA,
          model: aiModels.questionExtraction,
          temperature: aiModels.questionExtractionTemperature,
          maxTokens: aiModels.questionExtractionMaxTokens,
          requireParameters: true,
          messages: [
            {
              role: 'system',
              content:
                'Extraia somente questoes, exercicios ou problemas explicitamente presentes no texto. Nao invente perguntas, alternativas, gabarito ou explicacao. Se o trecho estiver incompleto, nao extraia a questao. Use kind OPEN_ENDED para questao discursiva, MULTIPLE_CHOICE para alternativas e TRUE_FALSE para verdadeiro/falso. Nao classifique topicos nesta etapa; a categorizacao sera feita por outro agente com uma lista fechada. sourceChunkIndexes deve conter os indices dos chunks que sustentam a questao.',
            },
            {
              role: 'user',
              content: `Texto:\n${text}`,
            },
          ],
        });

        const parsed = llmResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(`Resposta do LLM invalida: ${parsed.error.message}`);
        }

        console.log('Grupo de chunks validado pelo Zod', {
          event: 'monitor.question_llm_group_completed',
          documentId,
          groupNumber,
          attempt,
          questionCount: parsed.data.questions.length,
        });
        for (const question of parsed.data.questions) {
          this.candidateStartedAt.set(question, extractionStartedAt);
        }
        return parsed.data.questions;
      } catch (error) {
        console.log('Falha na extracao do grupo de chunks', {
          event: 'monitor.question_llm_group_failed',
          documentId,
          groupNumber,
          attempt,
          willRetry: attempt < MAX_RETRIES,
          error,
        });

        if (attempt === MAX_RETRIES) throw error;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }

    throw new Error('Extracao do grupo esgotou as tentativas.');
  }

  private async completeQuestionCandidate(
    candidate: z.infer<typeof extractedQuestionSchema>,
    sourceChunks: ExtractionChunk[],
  ): Promise<CandidateCompletion> {
    const sourceContext = sourceChunks
      .map((chunk) => chunk.content)
      .join('\n\n---\n\n')
      .slice(0, 18_000);
    const completed = await this.completionService.complete({
      documentId: sourceChunks[0]!.documentId,
      sourceBlockId: candidate.sourceBlockId ?? sourceChunks.find((chunk) => chunk.blockId)?.blockId ?? null,
      questionNumber: candidate.questionNumber ?? null,
      statement: candidate.text,
      alternatives: candidate.alternatives,
      correctAnswer: candidate.correctAnswer,
      explanation: candidate.explanation,
      sourceContext,
    });
    return {
      candidate: {
        ...candidate,
        kind: 'MULTIPLE_CHOICE',
        alternatives: completed.alternatives,
        correctAnswer: completed.correctAnswer,
        explanation: completed.explanation,
      },
      usedAi: completed.alternativesGenerated || completed.answerGenerated || completed.explanationGenerated,
      generatedAlternatives: completed.alternativesGenerated,
      generatedCorrectAnswer: completed.answerGenerated,
      generatedExplanation: completed.explanationGenerated,
      confidence: 0.8,
      inputSnapshot: {},
      outputSnapshot: {},
      generations: completed.generations,
      answerUsedDocumentRag: completed.answerUsedDocumentRag,
      answerDecisionSource: completed.answerDecisionSource,
      completionFailedAgents: completed.failedAgents,
      completionFailures: completed.agentFailures,
      missingFields: completed.missingFields,
      completenessStatus: completed.missingFields.length > 0
        ? resolveCompletenessStatus(completed.missingFields)
        : completed.alternativesGenerated || completed.answerGenerated || completed.explanationGenerated
          ? 'COMPLETE_WITH_AI'
          : 'COMPLETE_FROM_SOURCE',
    };

    /* Legacy monolithic completion retained below temporarily for reference.
    const sourceAlternatives = normalizeAlternatives(candidate.alternatives);
    const hasCompleteSourceAlternatives = sourceAlternatives.length === 5;
    const sourceAnswer = resolveAnswerLabel(candidate.correctAnswer, sourceAlternatives);
    const hasSourceAnswer = Boolean(sourceAnswer);
    const hasSourceExplanation = Boolean(candidate.explanation?.trim());
    if (hasCompleteSourceAlternatives && hasSourceAnswer && hasSourceExplanation) {
      return {
        candidate: {
          ...candidate,
          kind: 'MULTIPLE_CHOICE',
          alternatives: sourceAlternatives,
          correctAnswer: sourceAnswer,
        },
        usedAi: false,
        generatedAlternatives: false,
        generatedCorrectAnswer: false,
        generatedExplanation: false,
        confidence: 1,
        inputSnapshot: {},
        outputSnapshot: {},
        missingFields: [],
        completenessStatus: 'COMPLETE_FROM_SOURCE',
      };
    }

    const sourceContext = sourceChunks.map((chunk) => chunk.content).join('\n\n---\n\n').slice(0, 18_000);
    const inputSnapshot = {
      statement: candidate.text,
      sourceAlternatives,
      sourceCorrectAnswer: candidate.correctAnswer,
      sourceExplanation: candidate.explanation,
      sourceContext,
    };
    const missingCount = Number(!hasCompleteSourceAlternatives)
      + Number(!hasSourceAnswer)
      + Number(!hasSourceExplanation);
    const plannedCompletionTask: CompletionTask = missingCount === 1 && !hasSourceExplanation
      ? 'EXPLANATION_ONLY'
      : missingCount === 1 && !hasSourceAnswer
        ? 'ANSWER_ONLY'
        : missingCount === 1 && !hasCompleteSourceAlternatives
          ? 'ALTERNATIVES_ONLY'
          : 'FULL_COMPLETION';

    try {
      console.log('Completando questao com campos ausentes por IA', {
        event: 'monitor.question_ai_completion_started',
        sourceBlockId: candidate.sourceBlockId ?? null,
        sourceAlternativeCount: sourceAlternatives.length,
        hasCompleteSourceAlternatives,
        hasSourceAnswer,
        hasSourceExplanation,
      });
      const sourcePrompt = `Enunciado:\n${candidate.text}\n\nAlternativas da fonte:\n${sourceAlternatives.length > 0 ? sourceAlternatives.map((alternative) => `${alternative.label}) ${alternative.text}`).join('\n') : '(ausentes)'}\n\nGabarito documental:\n${candidate.correctAnswer?.trim() || '(ausente)'}\n\nContexto documental:\n${sourceContext}`;
      let alternatives = sourceAlternatives;
      let answer = sourceAnswer;
      let explanation = hasSourceExplanation ? candidate.explanation!.trim() : null;
      let confidence = 1;
      let task = 'source_document';
      let completionTask: CompletionTask = plannedCompletionTask;
      let generationType: CandidateCompletion['generationType'] = 'FULL_ENRICHMENT';
      let outputSnapshot: Record<string, unknown> = {};

      if (missingCount === 1 && !hasSourceExplanation) {
        task = 'question_explanation';
        completionTask = 'EXPLANATION_ONLY';
        generationType = 'EXPLANATION';
        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: task,
          schema: explanationOnlyJsonSchema,
          ...questionCompletionRequestOptions('EXPLANATION_ONLY'),
          messages: [
            { role: 'system', content: 'Explique a resolucao da questao exclusivamente com os dados fornecidos. Seja objetivo, com no maximo 700 caracteres. Retorne somente o JSON do schema.' },
            { role: 'user', content: sourcePrompt },
          ],
        });
        const parsed = explanationOnlyZodSchema.safeParse(raw);
        if (!parsed.success) {
          throw new StructuredCompletionError('INVALID_SCHEMA', 'A resposta de explicacao nao atende ao schema.', { model: aiModels.questionCompletion });
        }
        explanation = parsed.data.explanation.trim();
        confidence = 0.8;
        outputSnapshot = parsed.data;
      } else if (missingCount === 1 && !hasSourceAnswer) {
        task = 'question_answer';
        completionTask = 'ANSWER_ONLY';
        generationType = 'CORRECT_ANSWER';
        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: task,
          schema: answerOnlyJsonSchema,
          ...questionCompletionRequestOptions('ANSWER_ONLY'),
          messages: [
            { role: 'system', content: 'Determine somente a alternativa correta com base exclusiva no enunciado, alternativas e contexto. correctAnswer deve ser apenas A, B, C, D ou E. Retorne somente o JSON do schema.' },
            { role: 'user', content: sourcePrompt },
          ],
        });
        const parsed = answerOnlyZodSchema.safeParse(raw);
        if (!parsed.success) {
          throw new StructuredCompletionError('INVALID_SCHEMA', 'A resposta de gabarito nao atende ao schema.', { model: aiModels.questionCompletion });
        }
        answer = resolveAnswerLabel(parsed.data.correctAnswer, alternatives);
        confidence = 0.8;
        outputSnapshot = parsed.data;
      } else if (missingCount === 1 && !hasCompleteSourceAlternatives) {
        task = 'question_alternatives';
        completionTask = 'ALTERNATIVES_ONLY';
        generationType = 'ALTERNATIVES';
        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: task,
          schema: alternativesOnlyJsonSchema,
          ...questionCompletionRequestOptions('ALTERNATIVES_ONLY'),
          messages: [
            { role: 'system', content: 'Forneca exatamente cinco alternativas A, B, C, D e E. Preserve integralmente as alternativas documentais e sua ordem; complete somente as faltantes. Nao altere o gabarito documental. Retorne somente o JSON do schema.' },
            { role: 'user', content: sourcePrompt },
          ],
        });
        const parsed = alternativesOnlyZodSchema.safeParse(raw);
        if (!parsed.success) {
          throw new StructuredCompletionError('INVALID_SCHEMA', 'A resposta de alternativas nao atende ao schema.', { model: aiModels.questionCompletion });
        }
        alternatives = normalizeAlternatives(parsed.data.alternatives);
        confidence = 0.8;
        outputSnapshot = parsed.data;
      } else {
        task = 'question_completion_full';
        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: task,
          schema: questionCompletionJsonSchema,
          ...questionCompletionRequestOptions('FULL_COMPLETION'),
          messages: [
            { role: 'system', content: 'Complete a questao exclusivamente com base no enunciado, gabarito e contexto fornecidos. Nao use fatos externos. Retorne exatamente cinco alternativas A, B, C, D e E, com uma correta. correctAnswer deve conter somente a letra correta. Produza explicacao objetiva. Preserve integralmente alternativas documentais e sua ordem; complete somente as faltantes. Retorne somente o JSON do schema.' },
            { role: 'user', content: sourcePrompt },
          ],
        });
        const parsed = questionCompletionZodSchema.safeParse(raw);
        if (!parsed.success) {
          throw new StructuredCompletionError('INVALID_SCHEMA', 'A resposta de conclusao completa nao atende ao schema.', { model: aiModels.questionCompletion });
        }
        alternatives = hasCompleteSourceAlternatives ? sourceAlternatives : normalizeAlternatives(parsed.data.alternatives);
        answer = sourceAnswer || resolveAnswerLabel(parsed.data.correctAnswer, alternatives);
        explanation = hasSourceExplanation ? candidate.explanation!.trim() : parsed.data.explanation.trim();
        confidence = 0.75;
        outputSnapshot = parsed.data;
      }

      if (!preservesSourceAlternatives(sourceAlternatives, alternatives)) return null;
      if (!hasCompleteMultipleChoiceStructure(alternatives, answer)) return null;
      if (!explanation || explanation.length < 10) return null;
      const completedCandidate = {
        ...candidate,
        kind: 'MULTIPLE_CHOICE' as const,
        alternatives,
        correctAnswer: answer,
        explanation,
      };
      console.log('Questao completada por IA', {
        event: 'monitor.question_ai_completion_completed',
        sourceBlockId: candidate.sourceBlockId ?? null,
        alternativeCount: alternatives.length,
        answer,
        confidence,
      });
      return {
        candidate: completedCandidate,
        usedAi: true,
        generatedAlternatives: !hasCompleteSourceAlternatives,
        generatedCorrectAnswer: !hasSourceAnswer,
        generatedExplanation: !hasSourceExplanation,
        confidence,
        inputSnapshot: { ...inputSnapshot, task },
        outputSnapshot,
        generationType,
        completionTask,
        missingFields: [],
        completenessStatus: 'COMPLETE_WITH_AI',
      };
    } catch (error) {
      console.log('Falha ao completar campos obrigatorios da questao', {
        event: 'monitor.question_ai_completion_failed',
        sourceBlockId: candidate.sourceBlockId ?? null,
        error,
      });
      const pending = buildPendingReviewCompletion(candidate);
      return {
        ...pending,
        inputSnapshot: { ...inputSnapshot, task: plannedCompletionTask },
        outputSnapshot: {},
        completionTask: plannedCompletionTask,
        completionError: normalizeCompletionError(error),
      };
    }
    */
  }

  private async generateQuestionEmbeddings(
    candidates: Array<z.infer<typeof extractedQuestionSchema>>,
  ) {
    if (candidates.length === 0) return [] as number[][];

    try {
      console.log('Gerando embeddings das questoes extraidas', {
        event: 'monitor.question_embeddings_started',
        questionCount: candidates.length,
      });
      const batchSize = 128;
      const embeddings: number[][] = [];
      for (let offset = 0; offset < candidates.length; offset += batchSize) {
        const batch = candidates.slice(offset, offset + batchSize);
        const batchEmbeddings = await this.client.createEmbeddings(
          batch.map((candidate) => candidate.text),
        );
        embeddings.push(...batchEmbeddings);
      }
      console.log('Embeddings das questoes gerados', {
        event: 'monitor.question_embeddings_completed',
        questionCount: embeddings.length,
      });
      return embeddings;
    } catch (error) {
      console.log('Embeddings das questoes indisponiveis; seguindo com deduplicacao textual', {
        event: 'monitor.question_embeddings_failed_non_blocking',
        error,
      });
      return [] as number[][];
    }
  }
}

function buildPendingReviewCompletion(candidate: z.infer<typeof extractedQuestionSchema>): CandidateCompletion {
  const alternatives = normalizeAlternatives(candidate.alternatives);
  const correctAnswer = resolveAnswerLabel(candidate.correctAnswer, alternatives) || null;
  const explanation = candidate.explanation?.trim() || null;
  const missingFields: string[] = [];
  if (alternatives.length !== 5) missingFields.push('alternatives');
  if (!correctAnswer) missingFields.push('correctAnswer');
  if (!explanation) missingFields.push('explanation');
  const completenessStatus = resolveCompletenessStatus(missingFields);

  return {
    candidate: {
      ...candidate,
      kind: 'MULTIPLE_CHOICE',
      alternatives,
      correctAnswer,
      explanation,
    },
    usedAi: false,
    generatedAlternatives: false,
    generatedCorrectAnswer: false,
    generatedExplanation: false,
    confidence: 0,
    inputSnapshot: {},
    outputSnapshot: {},
    missingFields,
    completenessStatus,
  };
}

function mergeExistingQuestionFields(
  candidate: z.infer<typeof extractedQuestionSchema>,
  existing: {
    alternatives: Prisma.JsonValue;
    correctAnswer: string | null;
    explanation: string | null;
  },
) {
  const alternatives = parseStoredAlternatives(existing.alternatives);
  return {
    ...candidate,
    alternatives: alternatives.length === 5 ? alternatives : candidate.alternatives,
    correctAnswer: existing.correctAnswer ?? candidate.correctAnswer,
    explanation: existing.explanation ?? candidate.explanation,
  };
}

function parseStoredAlternatives(value: Prisma.JsonValue): Array<{ label: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as { label?: unknown; text?: unknown };
    return typeof candidate.label === 'string' && typeof candidate.text === 'string'
      ? [{ label: candidate.label, text: candidate.text }]
      : [];
  });
}

function resolveCompletenessStatus(
  missingFields: string[],
): CandidateCompletion['completenessStatus'] {
  if (missingFields.includes('alternatives')) return 'MISSING_ALTERNATIVES';
  if (missingFields.includes('correctAnswer')) return 'MISSING_ANSWER';
  if (missingFields.includes('explanation')) return 'MISSING_EXPLANATION';
  return 'COMPLETE_FROM_SOURCE';
}

type DeterministicBlock = {
  id: string;
  blockIndex: number;
  type: string;
  normalizedContent: string;
  questionNumber: string | null;
  institution: string | null;
  examYear: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  topicLinks: Array<{ topicId: string | null; confidence: number | null; isPrimary: boolean }>;
  chunks?: Array<{ id: string; chunkIndex: number }>;
};

type ChunkWithBlock = ExtractionChunk & { blockId: string | null };

function extractQuestionsFromBlocks(
  blocks: DeterministicBlock[],
  chunks: ChunkWithBlock[],
) {
  const answerKey = buildAnswerKeyMap(blocks);
  const solutions = buildSolutionMap(blocks);
  const candidates: Array<z.infer<typeof extractedQuestionSchema>> = [];

  for (const block of blocks.filter((candidate) => candidate.type === 'QUESTION')) {
    const parsed = parseQuestionBlock(block.normalizedContent);
    if (!parsed) {
      console.log('Bloco QUESTION ignorado pelo parser deterministico', {
        event: 'monitor.question_deterministic_block_invalid',
        blockId: block.id,
        blockIndex: block.blockIndex,
        reason: 'enunciado ou estrutura insuficiente',
      });
      continue;
    }

    const primaryTopic = block.topicLinks.find((link) => link.isPrimary && link.topicId)?.topicId
      ?? block.topicLinks.find((link) => link.topicId)?.topicId
      ?? null;
    if (!primaryTopic) {
      console.log('Bloco QUESTION sem topico principal seguira para revisao', {
        event: 'monitor.question_deterministic_topic_pending_review',
        blockId: block.id,
        blockIndex: block.blockIndex,
      });
    }

    const number = block.questionNumber ?? parseQuestionNumber(block.normalizedContent);
    const answerEntry = number ? answerKey.get(number) ?? null : null;
    const answer = answerEntry?.answer ?? null;
    const solution = number ? solutions.get(number) : undefined;
    const sourceChunks = chunks.filter((chunk) => chunk.blockId === block.id);
    if (sourceChunks.length === 0) continue;

    candidates.push({
      text: parsed.text,
      kind: parsed.kind,
      alternatives: parsed.alternatives,
      correctAnswer: answer,
      explanation: solution?.normalizedContent ?? null,
      topicId: primaryTopic,
      relatedTopics: block.topicLinks
        .filter((link): link is { topicId: string; confidence: number | null; isPrimary: boolean } => Boolean(link.topicId) && link.topicId !== primaryTopic && (link.confidence ?? 0) > 0.5)
        .map((link) => ({ topicId: link.topicId, confidence: link.confidence ?? 0 })),
      sourceChunkIndexes: sourceChunks.map((chunk) => chunk.chunkIndex),
      sourceBlockId: block.id,
      questionNumber: number,
      answerSourceChunkIndexes: answerEntry?.blockId
        ? chunks.filter((chunk) => chunk.blockId === answerEntry.blockId).map((chunk) => chunk.chunkIndex)
        : [],
      explanationSourceChunkIndexes: solution
        ? chunks.filter((chunk) => chunk.blockId === solution.id).map((chunk) => chunk.chunkIndex)
        : [],
      });

    console.log('Questao estruturada sem LLM', {
      event: 'monitor.question_deterministic_question_extracted',
      blockId: block.id,
      questionNumber: number,
      kind: parsed.kind,
      alternativeCount: parsed.alternatives.length,
      hasCorrectAnswer: Boolean(answer),
      hasExplanation: Boolean(solution),
      pageStart: block.pageStart,
      pageEnd: block.pageEnd,
    });
  }

  return candidates;
}

function parseQuestionBlock(content: string) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  if (isInvalidQuestionFragment(lines.join('\n'))) return null;
  const firstLine = lines[0]!
    .replace(/^(?:quest[aã]o\s*)?\d{1,3}[.)]\s*/i, '')
    .replace(/^ex(?:erc[ií]cio)?\.?\s*\d+\s*[:.)-]?\s*/i, '')
    .trim();
  const body = [firstLine, ...lines.slice(1)].join('\n').trim();
  const labeledAlternatives = parseAlternatives(body);
  const unlabeledAlternatives = labeledAlternatives.length === 0
    ? inferUnlabeledAlternatives(body.split('\n').map((line) => line.trim()).filter(Boolean))
    : null;
  const alternatives = labeledAlternatives.length > 0
    ? labeledAlternatives
    : unlabeledAlternatives?.alternatives ?? [];
  const firstAlternativeIndex = findFirstAlternativeIndex(body);
  const statement = unlabeledAlternatives?.statement
    ?? (firstAlternativeIndex >= 0 ? body.slice(0, firstAlternativeIndex) : body).trim();
  if (!hasQuestionIntent(statement, alternatives)) return null;

  const kind = alternatives.length >= 2
    ? (alternatives.every((alternative) => /^[VF]$/i.test(alternative.text.trim())) ? 'TRUE_FALSE' : 'MULTIPLE_CHOICE')
    : 'OPEN_ENDED';

  return {
    text: statement,
    kind,
    alternatives,
  } as const;
}

function isInvalidQuestionFragment(content: string) {
  const compact = content.trim();
  if (/^(?:[•∙●◦]\s*)?(?:\[[A-H]\]|[A-Ha-h][).:-])\s+/u.test(compact)) return true;
  if (/^(?:\[[A-H]\]|[Ⓐ-Ⓗ])\s*\d{1,3}[.)]/iu.test(compact)) return true;
  if (/^(?:gabarito|respostas?|refer[eê]ncias bibliogr[aá]ficas)\b/i.test(compact)) return true;
  if (/^(?:\[[A-H]\]|[Ⓐ-Ⓗ])\s*\d{1,3}\s*[.)\-:]/iu.test(compact) && compact.length < 180) return true;
  if (/^[•∙●◦\s]*(?:[\d.,]+|[A-Za-zÀ-ÿ])?\s*[=+*/^].*$/u.test(compact) && !/[?؟]|\b(quanto|qual|calcule|determine|resolva|encontre)\b/i.test(compact)) return true;
  return false;
}

function parseAlternatives(content: string) {
  const pattern = /(?:^|\s|\n)(?:\[\s*([A-Ha-h])\s*\]|([Ⓐ-Ⓗ])|([A-Ha-h])\s*[).:-]|\(?([1-5])\)?\s*[).:-])\s*/gu;
  const markers = Array.from(content.matchAll(pattern)).map((match) => ({
    label: match[1]?.toUpperCase() ?? (match[2] ? circledAlternativeToLetter(match[2]) : (match[3]?.toUpperCase() ?? match[4]!)),
    start: (match.index ?? 0) + match[0].length,
  }));
  return normalizeAlternatives(markers.map((marker, index) => ({
    label: marker.label,
    text: content.slice(marker.start, markers[index + 1]?.start ?? content.length).trim(),
  })).filter((alternative) => alternative.text.length > 0));
}

function findFirstAlternativeIndex(content: string) {
  const match = content.match(/(?:^|\s|\n)(?:\[\s*[A-Ha-h]\s*\]|[Ⓐ-Ⓗ]|[A-Ha-h]\s*[).:-]|\(?[1-5]\)?\s*[).:-])\s*/u);
  return match?.index ?? -1;
}

function inferUnlabeledAlternatives(lines: string[]) {
  const markerIndex = lines.findIndex((line) => /^(?:alternativas?|op[cç][oõ]es)\s*[:\-]?$/i.test(line));
  const markerCandidates = markerIndex >= 0 ? lines.slice(markerIndex + 1) : [];
  const bareCandidates = markerIndex < 0 && lines.length === 6
    ? lines.slice(1)
    : [];
  const candidates = markerCandidates.length > 0 ? markerCandidates : bareCandidates;
  if (candidates.length < 5) return null;

  const alternatives = candidates.slice(0, 5)
    .map((line) => line.replace(/^(?:[-•∙●◦]\s*)/, '').trim())
    .filter(Boolean);
  if (alternatives.length !== 5 || alternatives.some((alternative) => alternative.length > 280)) return null;

  const statementLines = markerIndex >= 0 ? lines.slice(0, markerIndex) : lines.slice(0, 1);
  const statement = statementLines.join('\n').trim();
  if (!hasQuestionIntent(statement, alternatives.map((text, index) => ({
    label: String.fromCharCode('A'.charCodeAt(0) + index),
    text,
  })))) return null;

  return {
    statement,
    alternatives: normalizeAlternatives(alternatives.map((text) => ({ label: '', text }))),
  };
}

function circledAlternativeToLetter(value: string) {
  const index = 'ⒶⒷⒸⒹⒺⒻⒼⒽ'.indexOf(value);
  return index >= 0 ? String.fromCharCode('A'.charCodeAt(0) + index) : value;
}

function buildAnswerKeyMap(blocks: DeterministicBlock[]) {
  const map = new Map<string, { answer: string; blockId: string }>();
  for (const block of blocks) {
    if (!/^ANSWER_KEY$/i.test((block as { type?: string }).type ?? '') && !/\b(gabarito|respostas?)\b/i.test(block.normalizedContent)) continue;
    const matches = Array.from(block.normalizedContent.matchAll(/(?:^|\s)(\d{1,3})\s*[.)\-:]\s*/gm));
    for (const [index, match] of matches.entries()) {
      const answerStart = (match.index ?? 0) + match[0].length;
      const answerEnd = matches[index + 1]?.index ?? block.normalizedContent.length;
      const answer = block.normalizedContent.slice(answerStart, answerEnd)
        .replace(/\s+/g, ' ')
        .trim();
      if (!answer || /^(?:resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b/i.test(answer)) continue;
      map.set(match[1]!, { answer, blockId: block.id });
    }
  }
  return map;
}

function buildSolutionMap(blocks: DeterministicBlock[]) {
  const map = new Map<string, DeterministicBlock>();
  for (const block of blocks) {
    if (block.type !== 'SOLUTION' && !blockIsSolution(block.normalizedContent)) continue;
    const number = block.questionNumber
      ?? block.normalizedContent.match(/^(?:(?:quest[aã]o\s*)?(\d{1,3})[.)]\s*)?(?:resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b/i)?.[1]
      ?? null;
    if (number) map.set(number, block);
  }
  return map;
}

function calculateQualityScore(
  candidate: z.infer<typeof extractedQuestionSchema>,
  completenessStatus: CandidateCompletion['completenessStatus'],
) {
  if (completenessStatus === 'MISSING_ALTERNATIVES') return 30;
  if (completenessStatus === 'MISSING_ANSWER') return 40;
  if (completenessStatus === 'MISSING_EXPLANATION') return 50;
  if (completenessStatus === 'COMPLETE_WITH_AI') return candidate.alternatives.length >= 4 ? 70 : 60;
  return candidate.alternatives.length >= 2 ? 95 : 85;
}

function hasQuestionIntent(statement: string, alternatives: Array<{ label: string; text: string }>) {
  const compact = statement.replace(/\s+/g, ' ').trim();
  if (compact.length < 12) return false;
  if (/^(?:[•∙●◦]\s*)?(?:\[[A-H]\]|[A-Ha-h][).:-])\s+/u.test(compact)) return false;
  if (/^(?:[•∙●◦]\s*)?[\d.,%\s]+(?:[=+*/^]|\b(?:de|por)\b)/iu.test(compact) && !/[?]|\b(quanto|qual|calcule|determine|resolva|encontre)\b/i.test(compact)) return false;

  return alternatives.length >= 2
    || /\?|\b(quanto|quantos|qual|quais|como|calcule|determine|resolva|encontre|obtenha|indique|assinale|marque|escreva|converta|transforme|complete|simplifique)\b/i.test(compact)
    || /^ex(?:erc[ií]cio)?\.?\s*\d+\s*[:.)-]/i.test(compact);
}

function isPlausibleQuestionCandidate(candidate: z.infer<typeof extractedQuestionSchema>) {
  if (isInvalidQuestionFragment(candidate.text)) return false;
  return hasQuestionIntent(candidate.text, candidate.alternatives);
}

function normalizeAlternatives(alternatives: Array<{ label: string; text: string }>) {
  return alternatives
    .map((alternative) => alternative.text.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((text, index) => ({
    label: String.fromCharCode('A'.charCodeAt(0) + index),
    text,
  }));
}

function resolveAnswerLabel(answer: string | null | undefined, alternatives: Array<{ label: string; text: string }>) {
  if (!answer?.trim()) return '';
  const compact = answer.trim();
  const label = compact.match(/^\[?\(?([A-Ea-e]|[1-5])\)?[\].):\-]?$/)?.[1];
  if (label) return /^[1-5]$/.test(label)
    ? String.fromCharCode('A'.charCodeAt(0) + Number(label) - 1)
    : label.toUpperCase();

  const comparableAnswer = normalizeComparableAnswer(compact);
  const matches = alternatives.filter((alternative) => normalizeComparableAnswer(alternative.text) === comparableAnswer);
  return matches.length === 1 ? matches[0]!.label : '';
}

function normalizeComparableAnswer(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/r\$/g, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^\p{L}\p{N}%$+\-./]/gu, '');
}

function preservesSourceAlternatives(
  sourceAlternatives: Array<{ label: string; text: string }>,
  completedAlternatives: Array<{ label: string; text: string }>,
) {
  return sourceAlternatives.every((alternative, index) => (
    completedAlternatives[index] !== undefined
    && normalizeComparableAnswer(completedAlternatives[index]!.text) === normalizeComparableAnswer(alternative.text)
  ));
}

function hasCompleteMultipleChoiceStructure(alternatives: Array<{ label: string; text: string }>, answer: string) {
  if (alternatives.length !== 5 || alternatives.some((alternative) => alternative.text.length === 0)) return false;
  const labels = alternatives.map((alternative) => alternative.label.toUpperCase());
  return labels.join('') === 'ABCDE' && labels.includes(answer);
}

function blockIsSolution(content: string) {
  return /\b(resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b/i.test(content);
}

function parseQuestionNumber(content: string) {
  return content.match(/^(?:quest[aã]o\s*)?(\d{1,3})[.)]/i)?.[1] ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFallbackQuestionBlock(type: string, content: string) {
  if (type !== 'EXAMPLE' && type !== 'THEORY') return false;
  return /\b(exerc[ií]cio|quest[aã]o|problema|calcule|determine|assinale|quanto|qual)\b/i.test(content);
}

function groupChunks(chunks: ExtractionChunk[], groupSize: number) {
  const groups: ExtractionChunk[][] = [];
  for (let index = 0; index < chunks.length; index += groupSize) {
    groups.push(chunks.slice(index, index + groupSize));
  }
  return groups;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function normalizeQuestionText(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildQuestionSourceKey(input: {
  documentId: string;
  sourceBlockId: string | null;
  questionNumber: string | null;
  statement: string;
}) {
  return createHash('sha256')
    .update([
      input.documentId,
      input.sourceBlockId ?? '',
      input.questionNumber ?? '',
      input.statement,
    ].join(':'))
    .digest('hex');
}

function questionCompletionRequestOptions(task: CompletionTask) {
  const maxTokens = (() => {
    switch (task) {
      case 'ANSWER_ONLY':
        return 80;
      case 'EXPLANATION_ONLY':
        return 350;
      case 'ALTERNATIVES_ONLY':
        return 300;
      case 'FULL_COMPLETION':
        return aiModels.questionCompletionMaxTokens;
    }
  })();

  return {
    model: aiModels.questionCompletion,
    temperature: aiModels.questionCompletionTemperature,
    maxTokens,
    requireParameters: true,
  };
}

function normalizeCompletionError(error: unknown) {
  if (error instanceof StructuredCompletionError) {
    return { code: error.code, finishReason: error.details.finishReason ?? null };
  }

  return { code: 'COMPLETION_REQUEST_FAILED', finishReason: null };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
