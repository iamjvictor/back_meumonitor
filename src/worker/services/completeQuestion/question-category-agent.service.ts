import {
  questionCategoryJsonSchema,
  questionCategoryZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative, QuestionTopicInput } from './question-completion.types.js';

export class QuestionCategoryAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async classify(input: {
    statement: string;
    alternatives: QuestionAlternative[];
    allowedTopics: QuestionTopicInput[];
  }): Promise<{
    classification: {
      primaryTopicId: string;
      relatedTopics: Array<{ topicId: string; confidence: number }>;
      generation: CompletionGeneration;
    } | null;
    failure?: QuestionAgentFailure | {
      code: 'NO_ALLOWED_TOPICS' | 'OUT_OF_SCOPE_TOPIC' | 'NO_PRIMARY_TOPIC';
      allowedTopicCount: number;
    };
  }> {
    if (input.allowedTopics.length === 0) {
      return { classification: null, failure: { code: 'NO_ALLOWED_TOPICS', allowedTopicCount: 0 } };
    }

    const response = await this.requestService.request({
      task: 'question_category',
      schema: questionCategoryJsonSchema,
      parser: questionCategoryZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Classifique a questao somente entre os topicos permitidos. Use exclusivamente os indices numericos fornecidos. Use as definicoes e orientacoes como criterio de desempate. Retorne primaryTopicIndex null quando nenhum topico for claramente compativel ou quando a confianca for baixa; nao force uma classificacao. relatedTopics e opcional e so pode conter topicos distintos do principal com confidence maior que 0.50. Nao invente indices nem texto fora do JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            allowedTopics: input.allowedTopics.map(({ index, name, definition, classificationGuidance, aiDefinition, aiClassificationGuidance }) => ({
              index,
              name,
              definition: definition || null,
              classificationGuidance: classificationGuidance || null,
              aiDefinition: aiDefinition || null,
              aiClassificationGuidance: aiClassificationGuidance || null,
            })),
            question: {
              statement: input.statement,
              alternatives: input.alternatives,
            },
          }),
        },
      ],
    });
    if (!response.data) return { classification: null, failure: response.failure };

    if (response.data.primaryTopicIndex === null) {
      return {
        classification: null,
        failure: { code: 'NO_PRIMARY_TOPIC', allowedTopicCount: input.allowedTopics.length },
      };
    }

    const primaryTopic = input.allowedTopics.find((topic) => topic.index === response.data.primaryTopicIndex);
    if (!primaryTopic) {
      return {
        classification: null,
        failure: { code: 'OUT_OF_SCOPE_TOPIC', allowedTopicCount: input.allowedTopics.length },
      };
    }
    const allowedTopicIndexes = new Set(input.allowedTopics.map((topic) => topic.index));
    const relatedTopics = response.data.relatedTopics.filter((topic) => (
      allowedTopicIndexes.has(topic.topicIndex)
      && topic.topicIndex !== response.data.primaryTopicIndex
      && topic.confidence > 0.5
    )).map((topic) => ({
      topicId: input.allowedTopics.find((allowed) => allowed.index === topic.topicIndex)!.id,
      confidence: topic.confidence,
    }));

    return {
      classification: {
        primaryTopicId: primaryTopic.id,
        relatedTopics,
        generation: {
          generationType: 'CATEGORY',
          model: response.model,
          inputSnapshot: {
            statement: input.statement,
            alternatives: input.alternatives,
            allowedTopics: input.allowedTopics,
          },
          outputSnapshot: {
            ...response.data,
            primaryTopicId: primaryTopic.id,
            relatedTopics,
          },
          confidence: 0.8,
        },
      },
    };
  }
}
