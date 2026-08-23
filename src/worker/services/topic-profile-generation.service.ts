import { z } from 'zod';
import { aiModels } from '../../config/ai-models.config.js';
import { OpenRouterClient } from '../client/openrouter.client.js';
import { searchReadyKnowledgeChunks } from '../../repositories/knowledge-retrieval.repository.js';
import {
  findTopicProfileContext,
  findTopicProfileContextsForSubject,
  saveGeneratedTopicProfile,
} from '../../repositories/topic-profile.repository.js';

const PROFILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    definition: { type: 'string', minLength: 20, maxLength: 1800 },
    classificationGuidance: { type: 'string', minLength: 20, maxLength: 2200 },
  },
  required: ['definition', 'classificationGuidance'],
};

const profileResponseSchema = z.object({
  definition: z.string().min(20).max(1800),
  classificationGuidance: z.string().min(20).max(2200),
}).strict();

export class TopicProfileGenerationService {
  constructor(private readonly client = new OpenRouterClient()) {}

  async processSubject(subjectId: string) {
    const topics = await findTopicProfileContextsForSubject(subjectId);
    const results = [];
    for (const topic of topics) {
      if (topic.aiDefinition?.trim()) continue;
      results.push(await this.generateTopicProfile(topic, false));
    }
    return results;
  }

  async processTopic(topicId: string) {
    const topic = await findTopicProfileContext(topicId);
    if (!topic) return { status: 'NOT_FOUND' as const };

    if (topic.aiDefinition?.trim()) {
      return { status: 'SKIPPED_EXISTING' as const, topicId };
    }

    return this.generateTopicProfile(topic, true);
  }

  private async generateTopicProfile(
    topic: NonNullable<Awaited<ReturnType<typeof findTopicProfileContext>>>,
    restrictToTopic: boolean,
  ) {

    const queryEmbedding = await this.client.createEmbeddings([
      `Definicao, conceitos, limites e exemplos do topico ${topic.name}`,
    ]);
    const sources = await searchReadyKnowledgeChunks({
      teacherId: topic.subject.monitor.teacherId,
      monitorId: topic.subject.monitorId,
      subjectId: topic.subjectId,
      ...(restrictToTopic ? { topicId: topic.id } : {}),
      queryEmbedding: queryEmbedding[0]!,
      limit: 12,
    });

    if (sources.length === 0) {
      return { status: 'NO_SOURCES' as const, topicId: topic.id };
    }

    const response = await this.client.createStructuredChatCompletion<unknown>({
      schemaName: 'topic_profile',
      schema: PROFILE_SCHEMA,
      model: aiModels.topicProfile,
      temperature: aiModels.topicProfileTemperature,
      maxTokens: aiModels.topicProfileMaxTokens,
      requireParameters: true,
      messages: [
        {
          role: 'system',
          content: 'Crie um perfil didatico para classificar questoes. Use somente os trechos fornecidos. A definicao deve explicar o conceito. A orientacao deve listar o que pertence ao topico e como diferencia-lo dos demais. Nao invente conteudo fora das fontes.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            topic: topic.name,
            sources: sources.map((source) => ({
              chunkId: source.chunkId,
              similarity: source.similarity,
              content: source.content.slice(0, 3500),
            })),
          }),
        },
      ],
    });

    const parsed = profileResponseSchema.parse(response);
    await saveGeneratedTopicProfile({
      topicId: topic.id,
      definition: parsed.definition,
      classificationGuidance: parsed.classificationGuidance,
      model: aiModels.topicProfile,
      sourceChunkIds: sources.map((source) => source.chunkId),
    });

    console.log('Perfil de topico gerado a partir da base de conhecimento', {
      event: 'monitor.topic_profile_generated',
      topicId: topic.id,
      topicName: topic.name,
      sourceCount: sources.length,
      model: aiModels.topicProfile,
    });

    return { status: 'GENERATED' as const, topicId: topic.id, sourceCount: sources.length };
  }
}
