import { aiModels } from '../../../config/ai-models.config.js';
import { OpenRouterClient, StructuredCompletionError, type StructuredRequestUsage } from '../../client/openrouter.client.js';
import type { QuestionAgentFailure } from './question-completion.types.js';

type SafeParser<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error?: { issues?: unknown[]; message?: string } };
};

export class QuestionCompletionRequestService {
  private static usageObserver: ((usage: StructuredRequestUsage & { task: string }) => void) | null = null;

  constructor(
    private readonly client = new OpenRouterClient(),
    private readonly options: { sleep?: (milliseconds: number) => Promise<void> } = {},
  ) {}

  static setUsageObserver(observer: ((usage: StructuredRequestUsage & { task: string }) => void) | null) {
    QuestionCompletionRequestService.usageObserver = observer;
  }

  async request<T>(input: {
    task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category' | 'question_quality_review' | 'question_quality_normalization' | 'question_boundary' | 'question_source_reconstruction' | 'question_correction';
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
          const data = await this.client.createStructuredChatCompletion<T>({
            schemaName: input.task,
            schema: input.schema,
            model,
            temperature: taskConfiguration.temperature,
            maxTokens: taskConfiguration.maxTokens,
            requireParameters: true,
            messages: compactMessages(input.messages, getPromptBudget(input.task, attempt)),
            validate: (value) => {
              const parsed = input.parser.safeParse(value);
              if (parsed.success) return parsed.data;
              const schemaError = new Error('Resposta estruturada nao atende ao schema local.');
              Object.assign(schemaError, { issues: parsed.error?.issues?.slice(0, 4) });
              throw schemaError;
            },
            onUsage: (usage) => QuestionCompletionRequestService.usageObserver?.({ ...usage, task: input.task }),
          });
          return { data, model, attempts: attempt };
        } catch (error) {
          const failure = normalizeFailure(input.task, error, model, attempt);
          lastFailure = failure;
          // Repeating the same truncated request does not produce a different JSON.
          const authenticationFailure = error instanceof StructuredCompletionError
            && error.code === 'PROVIDER_ERROR'
            && /\b401\b|user not found|unauthori[sz]ed|invalid api key/iu.test(error.message);
          // Um segundo parse pode recuperar uma resposta ocasionalmente mal
          // formada; repetir três vezes o mesmo schema aumenta custo sem
          // melhorar a qualidade. Truncamento já não faz retry.
          const maxAttempts = failure.code === 'INVALID_SCHEMA' ? 2 : 3;
          const hasNextAttempt = attempt < maxAttempts
            && failure.code !== 'MODEL_OUTPUT_TRUNCATED'
            // 404 indica modelo inexistente/indisponível para o provedor;
            // repetir a mesma chamada só aumenta latência e custo.
            && failure.statusCode !== 404
            && !authenticationFailure;
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
            await (this.options.sleep ?? sleep)(resolveRetryDelayMilliseconds(error, attempt));
          } else {
            break;
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
  task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category' | 'question_quality_review' | 'question_quality_normalization' | 'question_boundary' | 'question_source_reconstruction' | 'question_correction',
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
      nativeFinishReason: error.details.nativeFinishReason,
      statusCode: error.details.statusCode,
      retryAfterMs: error.details.retryAfterMs,
      validationError: error.details.validationError,
      responseContent: error.details.responseContent,
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

function toAgentName(task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category' | 'question_quality_review' | 'question_quality_normalization' | 'question_boundary' | 'question_source_reconstruction' | 'question_correction') {
  switch (task) {
    case 'question_alternatives': return 'ALTERNATIVES' as const;
    case 'question_answer': return 'CORRECT_ANSWER' as const;
    case 'question_explanation': return 'EXPLANATION' as const;
    case 'question_category': return 'CATEGORY' as const;
    case 'question_quality_review': return 'QUALITY_REVIEW' as const;
    case 'question_quality_normalization': return 'NORMALIZATION' as const;
    case 'question_boundary': return 'BOUNDARY' as const;
    case 'question_source_reconstruction': return 'SOURCE_RECONSTRUCTION' as const;
    case 'question_correction': return 'CORRECTION' as const;
  }
}

function getTaskConfiguration(task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category' | 'question_quality_review' | 'question_quality_normalization' | 'question_boundary' | 'question_source_reconstruction' | 'question_correction') {
  switch (task) {
    case 'question_alternatives':
      return {
        model: aiModels.questionAlternatives,
        maxTokens: Math.min(aiModels.questionAlternativesMaxTokens, 1200),
        temperature: aiModels.questionAlternativesTemperature,
      };
    case 'question_answer':
      return {
        model: aiModels.questionAnswer,
        maxTokens: Math.min(aiModels.questionAnswerMaxTokens, 300),
        temperature: aiModels.questionAnswerTemperature,
      };
    case 'question_explanation':
      return {
        model: aiModels.questionExplanation,
        maxTokens: Math.min(aiModels.questionExplanationMaxTokens, 900),
        temperature: aiModels.questionExplanationTemperature,
      };
    case 'question_category':
      return {
        model: aiModels.questionCategorize,
        maxTokens: Math.min(aiModels.questionCategorizeMaxTokens, 600),
        temperature: aiModels.questionCategorizeTemperature,
      };
    case 'question_quality_review':
      return {
        model: aiModels.questionQualityReview,
        maxTokens: aiModels.questionQualityReviewMaxTokens,
        temperature: aiModels.questionQualityReviewTemperature,
      };
    case 'question_quality_normalization':
      return {
        model: aiModels.questionQualityReview,
        // A normalizacao pode devolver cinco alternativas e uma explicacao;
        // o limite do review puro (normalmente 600) pode truncar esse patch.
        maxTokens: Math.max(aiModels.questionQualityReviewMaxTokens, 1200),
        temperature: 0,
      };
    case 'question_boundary':
      return {
        model: aiModels.questionQualityReview,
        maxTokens: Math.min(aiModels.questionQualityReviewMaxTokens, 450),
        temperature: 0,
      };
    case 'question_source_reconstruction':
      return {
        model: aiModels.questionSourceReconstruction,
        maxTokens: aiModels.questionSourceReconstructionMaxTokens,
        temperature: aiModels.questionSourceReconstructionTemperature,
      };
    case 'question_correction':
      return {
        model: aiModels.questionCompletion,
        maxTokens: aiModels.questionCompletionMaxTokens,
        temperature: aiModels.questionCompletionTemperature,
      };
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function resolveRetryDelayMilliseconds(error: unknown, attempt: number) {
  if (
    error instanceof StructuredCompletionError
    && error.code === 'RATE_LIMITED'
    && typeof error.details.retryAfterMs === 'number'
  ) {
    return Math.max(0, error.details.retryAfterMs);
  }

  return 500 * 2 ** (attempt - 1);
}

function getPromptBudget(
  task: 'question_alternatives' | 'question_answer' | 'question_explanation' | 'question_category' | 'question_quality_review' | 'question_quality_normalization' | 'question_boundary' | 'question_source_reconstruction' | 'question_correction',
  attempt: number,
) {
  const budgets = {
    question_alternatives: [10_000, 7_000, 5_000],
    question_answer: [14_000, 10_000, 7_000],
    question_explanation: [10_000, 7_000, 5_000],
    question_category: [8_000, 6_000, 4_000],
    question_quality_review: [14_000, 10_000, 7_000],
    question_quality_normalization: [14_000, 10_000, 7_000],
    question_boundary: [8_000, 6_000, 4_000],
    question_source_reconstruction: [14_000, 10_000, 7_000],
    question_correction: [14_000, 10_000, 7_000],
  } as const;

  const taskBudgets = budgets[task];
  return taskBudgets[Math.min(attempt - 1, taskBudgets.length - 1)] ?? taskBudgets[taskBudgets.length - 1] ?? 6000;
}

function compactMessages(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTotalChars: number,
) {
  const cloned = messages.map((message) => ({ ...message }));
  let totalChars = cloned.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars <= maxTotalChars) return cloned;

  const userIndexes = cloned
    .map((message, index) => ({ index, message }))
    .filter((entry) => entry.message.role === 'user')
    .sort((left, right) => right.message.content.length - left.message.content.length);

  for (const entry of userIndexes) {
    if (totalChars <= maxTotalChars) break;
    const overflow = totalChars - maxTotalChars;
    const nextLength = Math.max(600, entry.message.content.length - overflow - 64);
    const compacted = compactText(entry.message.content, nextLength);
    totalChars -= entry.message.content.length - compacted.length;
    cloned[entry.index] = { ...entry.message, content: compacted };
  }

  return cloned;
}

function compactText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const suffix = '\n\n[contexto reduzido para retry seguro]';
  const targetLength = Math.max(0, maxLength - suffix.length);
  return `${value.slice(0, targetLength).trimEnd()}${suffix}`;
}
