import {
  questionCategoryJsonSchema,
  questionCategoryZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative, QuestionTopicInput } from './question-completion.types.js';

function limitTopicContext(value: string | null | undefined, maxLength: number) {
  const normalized = value?.replace(/\s+/g, ' ').trim() || null;
  return normalized && normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

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
          content: 'Classifique a questao somente entre os topicos permitidos. Use exclusivamente o topicKey (UUID) fornecido para cada topico. Use as definicoes e orientacoes como criterio de desempate. Retorne primaryTopicKey null quando nenhum topico for claramente compativel ou quando a confianca for baixa; nao force uma classificacao. relatedTopics so pode conter topicKeys permitidos, distintos do principal, com confidence maior que 0.50. Nao invente UUIDs nem texto fora do JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            allowedTopics: input.allowedTopics.map(({ id, name, definition, classificationGuidance, aiDefinition, aiClassificationGuidance }) => ({
              topicKey: id,
              name,
              definition: limitTopicContext(definition, 700),
              classificationGuidance: limitTopicContext(classificationGuidance, 900),
              aiDefinition: limitTopicContext(aiDefinition, 700),
              aiClassificationGuidance: limitTopicContext(aiClassificationGuidance, 900),
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

    if (response.data.primaryTopicKey === null) {
      return {
        classification: null,
        failure: { code: 'NO_PRIMARY_TOPIC', allowedTopicCount: input.allowedTopics.length },
      };
    }

    const primaryTopic = input.allowedTopics.find((topic) => topic.id === response.data.primaryTopicKey);
    if (!primaryTopic) {
      return {
        classification: null,
        failure: { code: 'OUT_OF_SCOPE_TOPIC', allowedTopicCount: input.allowedTopics.length },
      };
    }
    const allowedTopicKeys = new Set(input.allowedTopics.map((topic) => topic.id));
    const relatedTopics = response.data.relatedTopics.filter((topic) => (
      allowedTopicKeys.has(topic.topicKey)
      && topic.topicKey !== response.data.primaryTopicKey
      && topic.confidence > 0.5
    )).map((topic) => ({
      topicId: topic.topicKey,
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
