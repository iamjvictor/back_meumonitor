import { aiModels } from '../../../config/ai-models.config.js';
import { OpenRouterClient, StructuredCompletionError } from '../../client/openrouter.client.js';
import type { QuestionAgentFailure } from './question-completion.types.js';

type SafeParser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

export class QuestionCompletionRequestService {
  constructor(private readonly client = new OpenRouterClient()) {}

  async request<T>(input: {
    task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category';
    schema: Record<string, unknown>;
    parser: SafeParser<T>;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
  }): Promise<{ data: T; model: string; attempts: number } | { data: null; failure: QuestionAgentFailure }> {
    const taskConfiguration = getTaskConfiguration(input.task);
    const models = [
      taskConfiguration.model,
      ...(aiModels.enablePaidStructuredFallback && aiModels.questionCompletionFallback
        ? [aiModels.questionCompletionFallback]
        : []),
    ];

    let lastFailure: QuestionAgentFailure | null = null;
    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const raw = await this.client.createStructuredChatCompletion<unknown>({
            schemaName: input.task,
            schema: input.schema,
            model,
            temperature: taskConfiguration.temperature,
            maxTokens: taskConfiguration.maxTokens,
            requireParameters: true,
            messages: input.messages,
          });
          const parsed = input.parser.safeParse(raw);
          if (parsed.success) {
            return { data: parsed.data, model, attempts: attempt };
          }
          throw new Error('Resposta estruturada nao atende ao schema local.');
        } catch (error) {
          const failure = normalizeFailure(input.task, error, model, attempt);
          lastFailure = failure;
          // Repeating the same truncated request does not produce a different JSON.
          const hasNextAttempt = attempt < 3 && failure.code !== 'MODEL_OUTPUT_TRUNCATED';
          console.log('Agente especializado de conclusao falhou', {
            event: 'monitor.question_completion_agent_failed',
            task: input.task,
            model,
            attempt,
            willRetry: hasNextAttempt,
            error,
            failure,
          });
          if (hasNextAttempt) {
            await sleep(500 * 2 ** (attempt - 1));
          }
        }
      }
    }

    return {
      data: null,
      failure: lastFailure ?? {
        agent: toAgentName(input.task),
        code: 'UNKNOWN',
        model: taskConfiguration.model,
        attempts: 0,
      },
    };
  }
}

function normalizeFailure(
  task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category',
  error: unknown,
  model: string,
  attempts: number,
): QuestionAgentFailure {
  if (error instanceof StructuredCompletionError) {
    return {
      agent: toAgentName(task),
      code: error.code,
      model: error.details.model || model,
      finishReason: error.details.finishReason,
      attempts,
    };
  }

  return {
    agent: toAgentName(task),
    code: 'INVALID_SCHEMA',
    model,
    attempts,
  };
}

function toAgentName(task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category') {
  switch (task) {
    case 'question_alternatives': return 'ALTERNATIVES' as const;
    case 'question_answer': return 'CORRECT_ANSWER' as const;
    case 'question_explanation': return 'EXPLANATION' as const;
    case 'question_category': return 'CATEGORY' as const;
  }
}

function getTaskConfiguration(task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category') {
  switch (task) {
    case 'question_alternatives':
      return {
        model: aiModels.questionAlternatives,
        maxTokens: aiModels.questionAlternativesMaxTokens,
        temperature: aiModels.questionAlternativesTemperature,
      };
    case 'question_answer':
      return {
        model: aiModels.questionAnswer,
        maxTokens: aiModels.questionAnswerMaxTokens,
        temperature: aiModels.questionAnswerTemperature,
      };
    case 'question_explanation':
      return {
        model: aiModels.questionExplanation,
        maxTokens: aiModels.questionExplanationMaxTokens,
        temperature: aiModels.questionExplanationTemperature,
      };
    case 'question_category':
      return {
        model: aiModels.questionCategorize,
        maxTokens: aiModels.questionCategorizeMaxTokens,
        temperature: aiModels.questionCategorizeTemperature,
      };
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
