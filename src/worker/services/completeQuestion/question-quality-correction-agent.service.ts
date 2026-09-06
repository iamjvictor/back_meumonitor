import {
  questionQualityCorrectionJsonSchema,
  questionQualityCorrectionZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative } from './question-completion.types.js';
import type { QuestionPatch } from './question-source-reconstruction-agent.service.js';

export type QuestionQualityCorrectionResult = {
  action?: 'CORRECT' | 'REPROCESS' | 'REVIEW';
  changes: QuestionPatch;
  generation?: CompletionGeneration;
  failure?: QuestionAgentFailure;
};

/** Aplica uma única correção pontual baseada no parecer da auditoria. */
export class QuestionQualityCorrectionAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async correct(input: {
    statement: string;
    alternatives: QuestionAlternative[];
    correctAnswer: string | null;
    explanation: string | null;
    reviewReasons: string[];
    sourceContext: string;
  }): Promise<QuestionQualityCorrectionResult> {
    const response = await this.requestService.request({
      task: 'question_correction',
      schema: questionQualityCorrectionJsonSchema,
      parser: questionQualityCorrectionZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Corrija uma questão após uma auditoria. Use somente a evidência fornecida. Retorne todos os campos de changes, usando null nos campos que não devem ser alterados e liste os campos alterados em changedFields. Preserve campos corretos e não repita a questão inteira. Se não houver evidência suficiente, action deve ser REPROCESS ou REVIEW e changedFields deve ser vazio. Não invente dados nem misture questões. Retorne somente JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: {
              statement: input.statement,
              alternatives: input.alternatives,
              correctAnswer: input.correctAnswer,
              explanation: input.explanation,
            },
            auditReasons: input.reviewReasons,
            sourceEvidence: input.sourceContext.slice(0, 9000),
          }),
        },
      ],
    });

    if (!response.data) return {
      changes: { statement: null, alternatives: null, correctAnswer: null, explanation: null, changedFields: [] },
      failure: response.failure,
    };

    return {
      action: response.data.action,
      changes: response.data.changes,
      generation: {
        generationType: 'CORRECTION',
        model: response.model,
        inputSnapshot: {
          statement: input.statement,
          alternatives: input.alternatives,
          correctAnswer: input.correctAnswer,
          explanation: input.explanation,
          reviewReasons: input.reviewReasons,
          sourceContext: input.sourceContext,
        },
          outputSnapshot: response.data,
        confidence: 0.8,
      },
    };
  }
}
