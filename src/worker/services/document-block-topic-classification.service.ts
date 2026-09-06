import { z } from 'zod';
import { aiModels } from '../../config/ai-models.config.js';
import { OpenRouterClient, StructuredCompletionError } from '../client/openrouter.client.js';
import {
  findBlockTopicClassificationData,
  replaceBlockTopicClassifications,
  markBlockTopicClassificationsPending,
  type BlockTopicClassificationInput,
} from '../../repositories/document-block-topic.repository.js';
import { searchReadyKnowledgeChunks } from '../../repositories/knowledge-retrieval.repository.js';

export function resolveBlockTopicFallback(allowedTopics: Array<{ id: string }>) {
  const topic = allowedTopics[0];
  return topic ? { topicId: topic.id, confidence: 0, classificationMethod: 'RULE' as const } : null;
}

const blockClassificationSchema = z.object({
  blockIndex: z.number().int().nonnegative(),
  primaryTopicId: z.string().uuid(),
}).strict();

const responseSchema = z.object({ classifications: z.array(blockClassificationSchema) }).strict();

const CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
          properties: {
          blockIndex: { type: 'integer' },
          primaryTopicId: { type: 'string' },
        },
        required: ['blockIndex', 'primaryTopicId'],
      },
    },
  },
  required: ['classifications'],
};

export class DocumentBlockTopicClassificationService {
  constructor(
    private readonly client = new OpenRouterClient(),
    private readonly options: { sleep?: (milliseconds: number) => Promise<void> } = {},
  ) {}

  async markPending(documentTextId: string) {
    return markBlockTopicClassificationsPending(documentTextId);
  }

  async process(documentId: string, documentTextId: string) {
    const startedAt = Date.now();
    const data = await findBlockTopicClassificationData(documentId, documentTextId);
    if (!data) throw new Error('Documento nao encontrado para classificacao de blocos.');

    const allowedTopics = data.topicLinks.map((link) => link.topic);
    console.log('Classificacao de escopo dos blocos iniciada', {
      event: 'monitor.document_block_topics_started',
      documentId,
      documentTextId,
      blockCount: data.blocks.length,
      allowedTopicCount: allowedTopics.length,
      inheritedTopicId: data.topicId,
    });

    if (data.blocks.length === 0) return { rowCount: 0, classifiedBlockCount: 0, outOfScopeBlockCount: 0 };

    if (data.topicId && allowedTopics.some((topic) => topic.id === data.topicId)) {
      const rows: BlockTopicClassificationInput[] = data.blocks.map((block) => ({
        blockId: block.id,
        topicId: data.topicId,
        classificationMethod: 'INHERITED',
        confidence: 1,
        status: 'CLASSIFIED',
        isPrimary: true,
      }));
      const result = await replaceBlockTopicClassifications(documentTextId, rows);
      console.log('Topico herdado para todos os blocos', {
        event: 'monitor.document_block_topics_inherited',
        documentId,
        documentTextId,
        topicId: data.topicId,
        blockCount: data.blocks.length,
      });
      return result;
    }

    const allowedTopicIds = new Set(allowedTopics.map((topic) => topic.id));
    const topicEvidence = await loadTopicEvidence(this.client, data, allowedTopics);
    const classifications: z.infer<typeof blockClassificationSchema>[] = [];

    const batchSize = aiModels.blockTopicClassificationBatchSize;
    for (let start = 0; start < data.blocks.length; start += batchSize) {
        const batch = data.blocks.slice(start, start + batchSize);
      console.log('Enviando blocos para classificacao da LLM', {
        event: 'monitor.document_block_topics_llm_batch_started',
        documentId,
        documentTextId,
        batchNumber: Math.floor(start / batchSize) + 1,
        blockIndexes: batch.map((block) => block.blockIndex),
        maxTokens: aiModels.blockTopicClassificationMaxTokens,
      });

      try {
        classifications.push(...await classifyTopicBatch(this.client, allowedTopics, batch.map((block) => ({
          ...block,
          sectionPath: normalizeSectionPath(block.sectionPath),
        })), { sleep: this.options.sleep, topicEvidence }));
      } catch (error) {
        console.log('Classificacao de lote falhou; blocos usarao topico fallback', { documentId, error });
      }
    }

    const rows: BlockTopicClassificationInput[] = [];
    for (const block of data.blocks) {
      const classification = classifications.find((item) => item.blockIndex === block.blockIndex);
      const primaryIsAllowed = classification ? allowedTopicIds.has(classification.primaryTopicId) : false;

      if (!classification || !primaryIsAllowed) {
        rows.push({
          blockId: block.id,
          topicId: resolveBlockTopicFallback(allowedTopics)?.topicId ?? null,
          classificationMethod: resolveBlockTopicFallback(allowedTopics)?.classificationMethod ?? 'LLM',
          confidence: resolveBlockTopicFallback(allowedTopics)?.confidence ?? null,
          status: resolveBlockTopicFallback(allowedTopics) ? 'CLASSIFIED' : 'OUT_OF_SCOPE',
          isPrimary: Boolean(resolveBlockTopicFallback(allowedTopics)),
        });
        continue;
      }

      rows.push({
        blockId: block.id,
        topicId: classification.primaryTopicId,
        classificationMethod: 'LLM',
        confidence: null,
        status: 'CLASSIFIED',
        isPrimary: true,
      });

    }

    const result = await replaceBlockTopicClassifications(documentTextId, rows);
    console.log('Classificacao de escopo dos blocos concluida', {
      event: 'monitor.document_block_topics_completed',
      documentId,
      documentTextId,
      rowCount: result.rowCount,
      classifiedBlockCount: result.classifiedBlockCount,
      outOfScopeBlockCount: result.outOfScopeBlockCount,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }
}

type AllowedTopic = {
  id: string;
  name: string;
  definition: string | null;
  classificationGuidance: string | null;
  aiDefinition: string | null;
  aiClassificationGuidance: string | null;
};

type TopicEvidence = Map<string, string[]>;

type DocumentBlockForClassification = {
  id: string;
  blockIndex: number;
  type: string;
  title: string | null;
  normalizedContent: string;
  sectionPath: string | null;
};

export async function classifyTopicBatch(
  client: Pick<OpenRouterClient, 'createStructuredChatCompletion'>,
  allowedTopics: AllowedTopic[],
  blocks: DocumentBlockForClassification[],
  options: { sleep?: (milliseconds: number) => Promise<void>; compactLevel?: number; topicEvidence?: TopicEvidence } = {},
): Promise<z.infer<typeof blockClassificationSchema>[]> {
  if (blocks.length === 0) return [];

  try {
    const classifications = await requestTopicBatch(
      client,
      allowedTopics,
      blocks,
      options.compactLevel ?? 0,
      options.topicEvidence,
    );
    validateClassificationCoverage(classifications, blocks, allowedTopics);
    return classifications;
  } catch (error) {
    if (!isRetryableClassificationError(error)) throw error;

    const retryAfterMs = error.details.retryAfterMs ?? 500;
    await (options.sleep ?? sleep)(retryAfterMs);

    if (blocks.length > 1) {
      const middle = Math.ceil(blocks.length / 2);
      const [left, right] = await Promise.all([
        classifyTopicBatch(client, allowedTopics, blocks.slice(0, middle), options),
        classifyTopicBatch(client, allowedTopics, blocks.slice(middle), options),
      ]);
      return [...left, ...right];
    }

    if ((options.compactLevel ?? 0) < 2) {
      return classifyTopicBatch(client, allowedTopics, blocks, {
        ...options,
        compactLevel: (options.compactLevel ?? 0) + 1,
      });
    }

    throw error;
  }
}

async function requestTopicBatch(
  client: Pick<OpenRouterClient, 'createStructuredChatCompletion'>,
  allowedTopics: AllowedTopic[],
  blocks: DocumentBlockForClassification[],
  compactLevel: number,
  topicEvidence?: TopicEvidence,
) {
  return client.createStructuredChatCompletion<z.infer<typeof responseSchema>>({
    schemaName: 'document_block_topic_classification',
    schema: CLASSIFICATION_SCHEMA,
    model: aiModels.documentBlockTopicClassification,
    temperature: aiModels.blockTopicClassificationTemperature,
    maxTokens: aiModels.blockTopicClassificationMaxTokens,
    requireParameters: true,
    validate: (value) => responseSchema.parse(value),
    messages: [
      {
        role: 'system',
        content: 'Classifique cada bloco no topico principal mais especifico da lista fornecida. Retorne exatamente uma classificacao para cada blockIndex recebido. Use somente um primaryTopicId existente na lista. Nao explique, nao crie topicos e retorne somente JSON compativel com o schema.',
      },
      {
        role: 'user',
        content: JSON.stringify(buildClassificationPayload(allowedTopics, blocks, compactLevel, topicEvidence)),
      },
    ],
  }).then((response) => response.classifications);
}

function buildClassificationPayload(
  allowedTopics: AllowedTopic[],
  blocks: DocumentBlockForClassification[],
  compactLevel: number,
  topicEvidence?: TopicEvidence,
) {
  const limits = getClassificationPayloadLimits(compactLevel, blocks.length);

  return {
    allowedTopics: allowedTopics.map((topic) => [
      topic.id,
      topic.name,
      limitTopicText(topic.aiDefinition ?? topic.definition, limits.topicDefinition),
      limitTopicText(topic.aiClassificationGuidance ?? topic.classificationGuidance, limits.topicGuidance),
      (topicEvidence?.get(topic.id) ?? []).map((item) => limitTopicText(item, limits.evidence)!).filter(Boolean),
    ]),
    blocks: blocks.map((block) => ({
      blockIndex: block.blockIndex,
      type: block.type,
      title: limitTopicText(block.title, 160),
      sectionPath: limitTopicText(block.sectionPath, 180),
      content: limitTopicText(block.normalizedContent, limits.blockContent),
    })),
  };
}

function getClassificationPayloadLimits(compactLevel: number, blockCount: number) {
  const presets = [
    { topicDefinition: 500, topicGuidance: 700, evidence: 500, blockContent: blockCount > 4 ? 1100 : 1500 },
    { topicDefinition: 320, topicGuidance: 420, evidence: 350, blockContent: blockCount > 2 ? 700 : 900 },
    { topicDefinition: 220, topicGuidance: 260, evidence: 250, blockContent: 550 },
  ] as const;
  type PayloadLimits = (typeof presets)[number];

  return (presets[Math.min(compactLevel, presets.length - 1)] ?? presets[presets.length - 1]) as PayloadLimits;
}

function validateClassificationCoverage(
  classifications: z.infer<typeof blockClassificationSchema>[],
  blocks: DocumentBlockForClassification[],
  allowedTopics: AllowedTopic[],
) {
  const expected = new Set(blocks.map((block) => block.blockIndex));
  const received = classifications.map((classification) => classification.blockIndex);
  const duplicates = received.filter((index, position) => received.indexOf(index) !== position);
  const missing = [...expected].filter((index) => !received.includes(index));
  const unexpected = received.filter((index) => !expected.has(index));
  const invalidTopics = classifications
    .filter((classification) => !allowedTopics.some((topic) => topic.id === classification.primaryTopicId))
    .map((classification) => classification.primaryTopicId);

  if (duplicates.length || missing.length || unexpected.length || invalidTopics.length || classifications.length !== blocks.length) {
    throw new StructuredCompletionError(
      'INVALID_SCHEMA',
      'A classificacao de blocos nao cobriu exatamente os blocos enviados ou usou topicos invalidos.',
      { model: aiModels.documentBlockTopicClassification, validationError: { duplicates, missing, unexpected, invalidTopics } },
    );
  }
}

async function loadTopicEvidence(
  client: Pick<OpenRouterClient, 'createEmbeddings'>,
  data: Awaited<ReturnType<typeof findBlockTopicClassificationData>>,
  allowedTopics: AllowedTopic[],
): Promise<TopicEvidence> {
  const evidence = new Map<string, string[]>();
  if (!data || allowedTopics.length === 0 || !data.subject) return evidence;

  try {
    const queries = allowedTopics.map((topic) => `${topic.name}. ${topic.aiDefinition ?? topic.definition ?? ''}`.trim());
    const embeddings = await client.createEmbeddings(queries);
    const results = await Promise.all(allowedTopics.map(async (topic, index) => {
      const candidates = await searchReadyKnowledgeChunks({
        teacherId: data.subject.monitor.teacherId,
        monitorId: data.subject.monitorId,
        subjectId: data.subjectId,
        queryText: topic.name,
        queryEmbedding: embeddings[index] ?? [],
        limit: 2,
        blockTypes: ['THEORY', 'EXAMPLE', 'QUESTION', 'SOLUTION'],
      });
      return [topic.id, candidates.map((candidate) => candidate.content)] as const;
    }));
    for (const [topicId, contents] of results) evidence.set(topicId, contents);
  } catch (error) {
    console.log('Evidencias RAG para classificacao indisponiveis; seguindo sem elas', {
      event: 'monitor.document_block_topics_rag_evidence_failed_non_blocking',
      error,
    });
  }
  return evidence;
}

function limitTopicText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? null;
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function isRetryableClassificationError(error: unknown): error is StructuredCompletionError {
  return error instanceof StructuredCompletionError
    && ['RATE_LIMITED', 'MODEL_OUTPUT_TRUNCATED', 'INVALID_SCHEMA', 'INVALID_JSON', 'EMPTY_RESPONSE'].includes(error.code);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeSectionPath(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
      .filter(Boolean)
      .join(' > ');
    return normalized || null;
  }
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}
