import {
  questionBoundaryJsonSchema,
  questionBoundaryZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { QuestionAgentFailure, QuestionAlternative } from './question-completion.types.js';

export type QuestionBoundaryDecision =
  | 'CONFIRMED'
  | 'NEEDS_PREVIOUS'
  | 'NEEDS_NEXT'
  | 'CONTAMINATED'
  | 'MULTI_ITEM'
  | 'INSUFFICIENT_EVIDENCE';

export class QuestionBoundaryValidationAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async validate(input: {
    questionNumber: string | null;
    statement: string;
    alternatives: QuestionAlternative[];
    sourceEvidence: string;
  }): Promise<{
    decision: QuestionBoundaryDecision;
    confidence: number;
    reason: string;
    relevantChunkIndexes: number[];
    failure?: QuestionAgentFailure;
    model?: string;
    attempts?: number;
  }> {
    const response = await this.requestService.request({
      task: 'question_boundary',
      schema: questionBoundaryJsonSchema,
      parser: questionBoundaryZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Valide somente as fronteiras da candidata. Nao resolva a questao e nao corrija campos. CONFIRMED significa que enunciado e alternativas pertencem a mesma questao; NEEDS_PREVIOUS/NEXT indicam continuacao; CONTAMINATED indica rodape, gabarito ou outra questao misturada; MULTI_ITEM indica subitens independentes; INSUFFICIENT_EVIDENCE indica falta de trecho. Retorne uma decisao curta e apenas JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            questionNumber: input.questionNumber,
            candidate: {
              statement: input.statement.slice(0, 2500),
              alternatives: input.alternatives.map((alternative) => ({
                label: alternative.label,
                text: alternative.text.slice(0, 350),
              })),
            },
            sourceEvidence: input.sourceEvidence.slice(0, 4500),
            rules: [
              'Use os marcadores CHUNK PRINCIPAL, CHUNK VIZINHO e PRÓXIMA QUESTÃO.',
              'Nao use conhecimento externo.',
              'relevantChunkIndexes deve conter somente indices presentes na evidencia.',
            ],
          }),
        },
      ],
    });

    if (!response.data) {
      return {
        decision: 'INSUFFICIENT_EVIDENCE',
        confidence: 0,
        reason: 'Validador de fronteiras indisponivel.',
        relevantChunkIndexes: [],
        failure: response.failure,
      };
    }

    return { ...response.data, model: response.model, attempts: response.attempts };
  }
}
