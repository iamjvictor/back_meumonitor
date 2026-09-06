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
    definition: { type: 'string', minLength: 80, maxLength: 1200 },
    classificationGuidance: { type: 'string', minLength: 120, maxLength: 1800 },
  },
  required: ['definition', 'classificationGuidance'],
};

const profileResponseSchema = z.object({
  definition: z.string().min(80).max(1200),
  classificationGuidance: z.string().min(120).max(1800),
}).strict();

function hasCurrentProfile(topic: { aiDefinition: string | null; aiClassificationGuidance?: string | null }) {
  const guidance = topic.aiClassificationGuidance || '';
  return Boolean(
    topic.aiDefinition?.trim()
    && /INCLUA:/i.test(guidance)
    && /EXCLUA:/i.test(guidance)
    && /DESEMPATE:/i.test(guidance),
  );
}

export class TopicProfileGenerationService {
  constructor(private readonly client = new OpenRouterClient()) {}

  async processSubject(subjectId: string) {
    const topics = await findTopicProfileContextsForSubject(subjectId);
    const results = [];
    for (const topic of topics) {
      if (hasCurrentProfile(topic)) continue;
      try {
        results.push(await this.generateTopicProfile(topic));
      } catch (error) {
        console.log('Perfil de topico falhou; demais topicos continuarao', {
          event: 'monitor.topic_profile_generation_failed_non_blocking',
          subjectId,
          topicId: topic.id,
          error,
        });
        results.push({ status: 'FAILED' as const, topicId: topic.id });
      }
    }
    return results;
  }

  async processTopic(topicId: string) {
    const topic = await findTopicProfileContext(topicId);
    if (!topic) return { status: 'NOT_FOUND' as const };

    if (hasCurrentProfile(topic)) {
      return { status: 'SKIPPED_EXISTING' as const, topicId };
    }

    return this.generateTopicProfile(topic);
  }

  private async generateTopicProfile(
    topic: NonNullable<Awaited<ReturnType<typeof findTopicProfileContext>>>,
  ) {

    const queryEmbedding = await this.client.createEmbeddings([
      `Definicao, conceitos, limites e exemplos do topico ${topic.name}`,
    ]);
    const sources = await searchReadyKnowledgeChunks({
      teacherId: topic.subject.monitor.teacherId,
      monitorId: topic.subject.monitorId,
      subjectId: topic.subjectId,
      queryEmbedding: queryEmbedding[0]!,
      limit: 6,
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
          content: [
            'Voce e um especialista em avaliacao educacional.',
            'Crie um perfil semantico e discriminativo, curto, para classificar questoes.',
            'Use os trechos recuperados como evidencia e a definicao manual como contexto; nao invente conteudo que nao esteja sustentado por eles.',
            'DEFINITION deve ser uma definicao pedagogica do conteudo, nunca uma explicacao sobre como classificar ou sobre o formato da questao.',
            'CLASSIFICATION_GUIDANCE deve conter exatamente estas secoes: INCLUA, EXCLUA, DESEMPATE.',
            'Escreva definition em 2 frases curtas, no maximo 500 caracteres.',
            'Escreva classificationGuidance em no maximo 3 linhas curtas, usando INCLUA, EXCLUA e DESEMPATE.',
            'Nao explique seu raciocinio e nao repita as fontes.',
            'Nao use dificuldade, formato, contexto (financeiro, geometrico etc.) ou habilidade generica como criterio suficiente.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            topic: topic.name,
            manualDefinition: topic.definition || null,
            manualClassificationGuidance: topic.classificationGuidance || null,
            neighboringTopics: topic.subject.topics
              .filter((candidate) => candidate.id !== topic.id)
              .map((candidate) => ({
                name: candidate.name,
                definition: candidate.definition?.slice(0, 500) || null,
                classificationGuidance: candidate.classificationGuidance?.slice(0, 700) || null,
              })),
            sources: sources.map((source) => ({
              chunkId: source.chunkId,
              similarity: source.similarity,
                content: source.content.slice(0, 1500),
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
