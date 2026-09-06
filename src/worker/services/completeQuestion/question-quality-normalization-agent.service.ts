import {
  questionQualityNormalizationJsonSchema,
  questionQualityNormalizationZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative } from './question-completion.types.js';
import type { QuestionPatch } from './question-source-reconstruction-agent.service.js';

export type QuestionQualityNormalizationResult = {
  decision: 'NORMALIZED' | 'PARTIAL_NORMALIZATION' | 'UNCHANGED' | 'REVIEW_REQUIRED';
  confidence: number;
  changes: QuestionPatch;
  fieldActions: {
    statement: 'KEPT' | 'CORRECTED' | 'GENERATED' | 'REMOVED' | 'UNVERIFIED';
    alternatives: 'KEPT' | 'CORRECTED' | 'GENERATED' | 'REMOVED' | 'UNVERIFIED';
    correctAnswer: 'KEPT' | 'CORRECTED' | 'GENERATED' | 'REMOVED' | 'UNVERIFIED';
    explanation: 'KEPT' | 'CORRECTED' | 'GENERATED' | 'REMOVED' | 'UNVERIFIED';
  };
  checks: {
    statementMakesSense: boolean;
    alternativesMatchStatement: boolean;
    answerMatchesAlternative: boolean;
    explanationMatchesAnswer: boolean;
    solvable: boolean;
  };
  evidence: string[];
  model?: string;
  attempts?: number;
  generation?: CompletionGeneration;
  failure?: QuestionAgentFailure;
};

const emptyChanges = (): QuestionPatch => ({
  statement: null,
  alternatives: null,
  correctAnswer: null,
  explanation: null,
  changedFields: [],
});

/**
 * Normaliza a questão inteira depois dos agentes especializados.
 * Diferentemente do review, este agente pode devolver um patch final por campo.
 */
export class QuestionQualityNormalizationAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async normalize(input: {
    questionNumber: string | null;
    statement: string;
    alternatives: QuestionAlternative[];
    correctAnswer: string | null;
    explanation: string | null;
    sourceContext: string;
    generatedFields: string[];
  }): Promise<QuestionQualityNormalizationResult> {
    const response = await this.requestService.request({
      task: 'question_quality_normalization',
      schema: questionQualityNormalizationJsonSchema,
      parser: questionQualityNormalizationZodSchema,
      messages: [
        {
          role: 'system',
          content: [
            'Voce e o agente final de auditoria e normalizacao de uma questao de multipla escolha.',
            'Compare a questao com o contexto de origem, corrija a formatacao e devolva um patch final por campo.',
            'Voce pode corrigir alternativas, gabarito e explicacao; tambem pode gerar explicacao ou gabarito quando a questao for resolvivel.',
            'Campos gerados por IA nao precisam aparecer literalmente no contexto: valide-os pelo enunciado, pelas alternativas e pelo calculo.',
            'Se nao houver evidencia para um campo, preserve-o com null em changes e marque a acao como UNVERIFIED. Nao invalide a questao apenas por falta de evidencia textual.',
            'Nunca invente dados numericos, alternativas ou premissas ausentes. Nao misture questoes vizinhas.',
            'Nunca troque um gabarito atual valido apenas para completar cinco alternativas. Adicionar uma alternativa nao altera o gabarito.',
            'Se a explicacao ou o calculo indicar explicitamente uma letra, ela deve ser coerente com correctAnswer e com o texto da alternativa.',
            'Nao mencione OCR, documento, fonte, IA, alternativas adicionadas, regra de cinco alternativas ou o processo de revisao dentro da explicacao.',
            'Retorne somente JSON compacto. Em changes, use null para campos que nao devem ser alterados e liste os campos alterados em changedFields.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            questionNumber: input.questionNumber,
            question: {
              statement: input.statement,
              alternatives: input.alternatives,
              correctAnswer: input.correctAnswer,
              explanation: input.explanation,
            },
            generatedFields: input.generatedFields,
            sourceContext: input.sourceContext.slice(0, 16000),
            outputRules: [
              'A resposta deve conter exatamente cinco alternativas A-E quando elas forem recuperaveis ou geraveis com seguranca.',
              'O gabarito deve ser uma letra A-E e precisa corresponder a uma alternativa.',
              'A explicacao deve resolver esta questao e justificar o gabarito; remova propaganda, rodape e texto de outra questao.',
              'Se um campo atual estiver correto, preserve-o.',
              'Se correctAnswer atual for uma letra A-E e estiver entre as alternativas, preserve-o salvo evidencia direta de que esta errado.',
              'Se um campo nao puder ser corrigido, nao o apague: deixe changes.<campo> como null e use UNVERIFIED.',
            ],
          }),
        },
      ],
    });

    if (!response.data) {
      return {
        decision: 'REVIEW_REQUIRED',
        confidence: 0,
        changes: emptyChanges(),
        fieldActions: {
          statement: 'UNVERIFIED', alternatives: 'UNVERIFIED', correctAnswer: 'UNVERIFIED', explanation: 'UNVERIFIED',
        },
        checks: {
          statementMakesSense: false,
          alternativesMatchStatement: false,
          answerMatchesAlternative: false,
          explanationMatchesAnswer: false,
          solvable: false,
        },
        evidence: [],
        failure: response.failure,
      };
    }

    const data = response.data;
    return {
      ...data,
      model: response.model,
      attempts: response.attempts,
      generation: {
        generationType: 'NORMALIZATION',
        model: response.model,
        inputSnapshot: {
          questionNumber: input.questionNumber,
          statement: input.statement,
          alternatives: input.alternatives,
          correctAnswer: input.correctAnswer,
          explanation: input.explanation,
          generatedFields: input.generatedFields,
          sourceContext: input.sourceContext,
        },
        outputSnapshot: data,
        confidence: data.confidence,
      },
    };
  }
}
