import {
  questionSourceReconstructionJsonSchema,
  questionSourceReconstructionZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { QuestionAgentFailure, QuestionAlternative } from './question-completion.types.js';

export type SourceReconstructionResult = {
  changes: QuestionPatch;
  changed: boolean;
  confidence: number;
  evidence: string[];
  recommendedAction: 'REVIEW' | 'REPROCESS' | 'KEEP';
  model?: string;
  attempts?: number;
  failure?: QuestionAgentFailure;
};

export type QuestionPatch = {
  statement: string | null;
  alternatives: QuestionAlternative[] | null;
  correctAnswer: string | null;
  explanation: string | null;
  changedFields: Array<'statement' | 'alternatives' | 'correctAnswer' | 'explanation'>;
};

export class QuestionSourceReconstructionAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async reconstruct(input: {
    questionNumber: string | null;
    statement: string;
    alternatives: QuestionAlternative[];
    correctAnswer: string | null;
    explanation: string | null;
    sourceEvidence: string;
    convertToMultipleChoice?: boolean;
  }): Promise<SourceReconstructionResult> {
    const conversionRequired = input.convertToMultipleChoice === true;
    const response = await this.requestService.request({
      task: 'question_source_reconstruction',
      schema: questionSourceReconstructionJsonSchema,
      parser: questionSourceReconstructionZodSchema,
      messages: [
        {
          role: 'system',
          content: conversionRequired
            ? 'CONVERSAO OBRIGATORIA PARA MULTIPLA ESCOLHA: gere um patch em changes para transformar esta questao aberta em uma unica pergunta objetiva. Preserve tema, dados e pergunta principal; remova subitens e cortes de outras questoes. Crie exatamente cinco alternativas A-E e resolva a questao usando somente a evidencia. A explicacao deve justificar a resposta. Em changedFields liste todos os campos alterados. Nao misture questoes e retorne somente JSON.'
            : 'Gere um patch em changes para uma questao a partir dos trechos. Corrija somente cortes de coluna/pagina, alternativas, gabarito ou explicacao sustentados explicitamente. Nunca invente dados, numeros, alternativas ou respostas. Se nao houver evidencia suficiente, mantenha os campos sem alteracao e retorne REPROCESS. Nao misture questoes. Retorne somente JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            candidate: {
              questionNumber: input.questionNumber,
              statement: input.statement,
              alternatives: input.alternatives,
              correctAnswer: input.correctAnswer,
              explanation: input.explanation,
              conversionRequired,
            },
            sourceEvidence: input.sourceEvidence.slice(0, 9000),
            rules: [
              'O texto entre marcadores CHUNK PRINCIPAL e CHUNK VIZINHO e a unica fonte autorizada.',
              'Use o questionNumber para nao misturar questoes; se a continuacao pertencer a outra questao, nao a use.',
              conversionRequired
                ? 'Como a questao e aberta, Alternatives deve conter exatamente cinco opcoes plausiveis e distintas, derivadas do enunciado e do calculo sustentado pela evidencia; nao use subitens ou texto de outra questao como opcoes.'
                : 'Alternatives deve conter somente alternativas encontradas nos trechos; alternativas ausentes permanecem vazias.',
              'correctAnswer deve ser null quando nao estiver no gabarito ou nao puder ser comprovado por calculo seguro.',
              'Retorne sempre todos os campos de changes. Use null nos campos que nao devem ser alterados e liste somente os campos alterados em changedFields. evidence deve ser curta.',
            ],
          }),
        },
      ],
    });

    if (!response.data) {
      return {
        changes: { statement: null, alternatives: null, correctAnswer: null, explanation: null, changedFields: [] },
        changed: false,
        confidence: 0,
        evidence: [],
        recommendedAction: 'REPROCESS',
        failure: response.failure,
      };
    }

    return { ...response.data, model: response.model, attempts: response.attempts };
  }
}
