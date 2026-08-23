import { z } from 'zod';
import { aiModels } from '../../config/ai-models.config.js';
import { OpenRouterClient } from '../client/openrouter.client.js';
import {
  findBlockTopicClassificationData,
  replaceBlockTopicClassifications,
  markBlockTopicClassificationsPending,
  type BlockTopicClassificationInput,
} from '../../repositories/document-block-topic.repository.js';

const RELATED_TOPIC_THRESHOLD = 0.5;

const relatedTopicSchema = z.object({
  topicId: z.string().uuid(),
  confidence: z.number().min(0).max(1),
});

const blockClassificationSchema = z.object({
  blockIndex: z.number().int().nonnegative(),
  primaryTopicId: z.string().uuid().nullable(),
  primaryConfidence: z.number().min(0).max(1).nullable(),
  relatedTopics: z.array(relatedTopicSchema),
});

const responseSchema = z.object({ classifications: z.array(blockClassificationSchema) });

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
          primaryTopicId: { type: ['string', 'null'] },
          primaryConfidence: { type: ['number', 'null'] },
          relatedTopics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                topicId: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['topicId', 'confidence'],
            },
          },
        },
        required: ['blockIndex', 'primaryTopicId', 'primaryConfidence', 'relatedTopics'],
      },
    },
  },
  required: ['classifications'],
};

export class DocumentBlockTopicClassificationService {
  constructor(private readonly client = new OpenRouterClient()) {}

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

      const response = await this.client.createStructuredChatCompletion<unknown>({
        schemaName: 'document_block_topic_classification',
        schema: CLASSIFICATION_SCHEMA,
        model: aiModels.documentBlockTopicClassification,
        temperature: aiModels.blockTopicClassificationTemperature,
        maxTokens: aiModels.blockTopicClassificationMaxTokens,
        requireParameters: true,
        messages: [
          {
            role: 'system',
            content: 'Classifique blocos educacionais somente entre os topicos permitidos. Escolha um unico topico principal quando a compatibilidade for clara. Pode retornar primaryTopicId null quando nenhum topico for compativel. So inclua relatedTopics com confidence estritamente maior que 0.50. Nunca invente topicos.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              allowedTopics: allowedTopics.map((topic) => ({
                id: topic.id,
                name: topic.name,
                definition: topic.definition,
                classificationGuidance: topic.classificationGuidance,
                aiDefinition: topic.aiDefinition,
                aiClassificationGuidance: topic.aiClassificationGuidance,
              })),
              blocks: batch.map((block) => ({
                blockIndex: block.blockIndex,
                type: block.type,
                title: block.title,
                sectionPath: block.sectionPath,
                content: block.normalizedContent,
              })),
            }),
          },
        ],
      });

      const parsed = responseSchema.parse(response);
      classifications.push(...parsed.classifications);
    }

    const rows: BlockTopicClassificationInput[] = [];
    for (const block of data.blocks) {
      const classification = classifications.find((item) => item.blockIndex === block.blockIndex);
      const primaryIsAllowed = classification?.primaryTopicId
        ? allowedTopicIds.has(classification.primaryTopicId)
        : false;

      if (!classification || !primaryIsAllowed) {
        rows.push({
          blockId: block.id,
          topicId: null,
          classificationMethod: 'LLM',
          confidence: classification?.primaryConfidence ?? null,
          status: 'OUT_OF_SCOPE',
          isPrimary: false,
        });
        continue;
      }

      rows.push({
        blockId: block.id,
        topicId: classification.primaryTopicId,
        classificationMethod: 'LLM',
        confidence: classification.primaryConfidence,
        status: 'CLASSIFIED',
        isPrimary: true,
      });

      for (const related of classification.relatedTopics) {
        if (
          allowedTopicIds.has(related.topicId)
          && related.topicId !== classification.primaryTopicId
          && related.confidence > RELATED_TOPIC_THRESHOLD
        ) {
          rows.push({
            blockId: block.id,
            topicId: related.topicId,
            classificationMethod: 'LLM',
            confidence: related.confidence,
            status: 'CLASSIFIED',
            isPrimary: false,
          });
        }
      }
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
