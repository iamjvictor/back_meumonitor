import {
  questionQualityReviewJsonSchema,
  questionQualityReviewZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { QuestionAgentFailure, QuestionAlternative } from './question-completion.types.js';

export type AiQuestionQualityReview = {
  valid: boolean;
  score: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  confidence: number;
  reasons: string[];
  recommendedAction: 'REVIEW' | 'CORRECT' | 'REPROCESS' | 'DUPLICATE' | 'KEEP';
  model?: string;
  attempts?: number;
  failure?: QuestionAgentFailure;
};

export class QuestionQualityReviewAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async review(input: {
    statement: string;
    alternatives: QuestionAlternative[];
    correctAnswer: string | null;
    explanation: string | null;
    sourceContext: string;
  }): Promise<AiQuestionQualityReview> {
    const response = await this.requestService.request({
      task: 'question_quality_review',
      schema: questionQualityReviewJsonSchema,
      parser: questionQualityReviewZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Revise uma questão de múltipla escolha como um auditor pedagógico. Verifique se o enunciado é completo e coerente, se as alternativas respondem ao mesmo enunciado, se existe apenas uma resposta defensável, se o gabarito é compatível e se a explicação sustenta o gabarito. Não reescreva nada. Retorne somente JSON. Como o professor sempre aprova depois, KEEP significa apenas que não há erro evidente, não significa aprovação final.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            statement: input.statement,
            alternatives: input.alternatives,
            correctAnswer: input.correctAnswer,
            explanation: input.explanation,
            sourceContext: input.sourceContext.slice(0, 12000),
          }),
        },
      ],
    });

    if (!response.data) {
      return {
        valid: false,
        score: 0,
        severity: 'CRITICAL',
        confidence: 0,
        reasons: ['AI_REVIEW_FAILED'],
        recommendedAction: 'REVIEW',
        failure: response.failure,
      };
    }
    return { ...response.data, model: response.model, attempts: response.attempts };
  }
}
