import {
  explanationOnlyJsonSchema,
  explanationOnlyZodSchema,
} from '../../schemas/question-completion.schema.js';
import { formatAlternatives } from './question-alternatives-agent.service.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionCompletionInput } from './question-completion.types.js';

export class QuestionExplanationAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async complete(input: QuestionCompletionInput): Promise<{
    explanation: string | null;
    generated: boolean;
    generation?: CompletionGeneration;
    failure?: QuestionAgentFailure;
  }> {
    const explanation = input.explanation?.trim();
    if (explanation && explanation.length >= 10) return { explanation, generated: false };

    const response = await this.requestService.request({
      task: 'question_explanation',
      schema: explanationOnlyJsonSchema,
      parser: explanationOnlyZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Explique a resolucao em portugues usando somente o enunciado e alternativas. Seja objetivo, com no maximo 700 caracteres. Nao exponha raciocinio interno nem texto fora do JSON.',
        },
        {
          role: 'user',
          content: `Enunciado:\n${input.statement}\n\nAlternativas:\n${formatAlternatives(input.alternatives)}\n\nGabarito:\n${input.correctAnswer ?? '(ausente)'}`,
        },
      ],
    });
    if (!response.data) {
      return { explanation: null, generated: false, failure: response.failure };
    }
    if (response.data.explanation.trim().length < 10) {
      return {
        explanation: null,
        generated: false,
        failure: {
          agent: 'EXPLANATION',
          code: 'INVALID_EXPLANATION',
          model: response.model,
          attempts: response.attempts,
        },
      };
    }

    return {
      explanation: response.data.explanation.trim(),
      generated: true,
      generation: {
        generationType: 'EXPLANATION',
        model: response.model,
        inputSnapshot: { statement: input.statement, alternatives: input.alternatives, correctAnswer: input.correctAnswer },
        outputSnapshot: response.data,
        confidence: 0.8,
      },
    };
  }
}
