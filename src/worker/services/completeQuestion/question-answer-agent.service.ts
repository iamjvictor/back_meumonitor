import { findDocumentRagContextForQuestionAnswer } from '../../../repositories/question.repository.js';
import { OpenRouterClient } from '../../client/openrouter.client.js';
import {
  answerOnlyJsonSchema,
  answerOnlyZodSchema,
} from '../../schemas/question-completion.schema.js';
import { formatAlternatives } from './question-alternatives-agent.service.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative, QuestionCompletionInput } from './question-completion.types.js';

export class QuestionAnswerAgentService {
  constructor(
    private readonly requestService = new QuestionCompletionRequestService(),
    private readonly client = new OpenRouterClient(),
  ) {}

  async complete(input: QuestionCompletionInput, alternatives: QuestionAlternative[]): Promise<{
    correctAnswer: string | null;
    generated: boolean;
    usedDocumentRag: boolean;
    decisionSource: 'SOURCE_DOCUMENT' | 'DOCUMENT_RAG' | 'MODEL_INFERENCE' | null;
    generation?: CompletionGeneration;
    failure?: QuestionAgentFailure;
  }> {
    const sourceAnswer = resolveAnswerLabel(input.correctAnswer, alternatives);
    if (sourceAnswer) {
      return {
        correctAnswer: sourceAnswer,
        generated: false,
        usedDocumentRag: false,
        decisionSource: 'SOURCE_DOCUMENT',
      };
    }

    const rag = await this.retrieveDocumentContext(input, alternatives);
    const response = await this.requestService.request({
      task: 'question_answer',
      schema: answerOnlyJsonSchema,
      parser: answerOnlyZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Determine somente a alternativa correta. Priorize gabarito ou resolucao documental quando existir; caso contrario, infira pela questao. Retorne null apenas se nao for possivel determinar. Nao escreva explicacoes nem texto fora do JSON.',
        },
        {
          role: 'user',
          content: `Enunciado:\n${input.statement}\n\nAlternativas:\n${formatAlternatives(alternatives)}\n\nContexto documental recuperado:\n${rag.context || '(nenhum trecho adicional encontrado)'}`,
        },
      ],
    });
    if (!response.data) {
      return {
        correctAnswer: null,
        generated: false,
        usedDocumentRag: rag.used,
        decisionSource: null,
        failure: response.failure,
      };
    }

    const correctAnswer = resolveAnswerLabel(response.data.correctAnswer, alternatives);
    if (!correctAnswer) {
      return {
        correctAnswer: null,
        generated: false,
        usedDocumentRag: rag.used,
        decisionSource: null,
        failure: {
          agent: 'CORRECT_ANSWER',
          code: 'INVALID_ANSWER',
          model: response.model,
          attempts: response.attempts,
        },
      };
    }
    return {
      correctAnswer,
      generated: true,
      usedDocumentRag: rag.used,
      decisionSource: rag.used ? 'DOCUMENT_RAG' : 'MODEL_INFERENCE',
      generation: {
        generationType: 'CORRECT_ANSWER',
        model: response.model,
        inputSnapshot: { statement: input.statement, alternatives, ragContext: rag.context },
        outputSnapshot: response.data,
        confidence: rag.used ? 0.85 : 0.7,
      },
    };
  }

  private async retrieveDocumentContext(input: QuestionCompletionInput, alternatives: QuestionAlternative[]) {
    try {
      const query = `${input.statement}\n${formatAlternatives(alternatives)}`;
      const [embedding] = await this.client.createEmbeddings([query]);
      if (!embedding) return { context: '', used: false };
      const chunks = await findDocumentRagContextForQuestionAnswer(input.documentId, embedding);
      const context = chunks
        .map((chunk) => chunk.content)
        .join('\n\n---\n\n')
        .slice(0, 8_000);
      return { context, used: context.length > 0 };
    } catch (error) {
      console.log('RAG de gabarito indisponivel; agente continuara por inferencia', {
        event: 'monitor.question_answer_agent_rag_failed_non_blocking',
        documentId: input.documentId,
        sourceBlockId: input.sourceBlockId,
        error,
      });
      return { context: '', used: false };
    }
  }
}

function resolveAnswerLabel(rawAnswer: string | null, alternatives: QuestionAlternative[]) {
  if (!rawAnswer) return null;
  const normalized = rawAnswer.trim().toUpperCase();
  const letter = normalized.match(/(?:^|[^A-Z])([A-E])(?:$|[^A-Z])/)?.[1];
  if (letter && alternatives.some((alternative) => alternative.label === letter)) return letter;

  const index = Number.parseInt(normalized.replace(/[^0-9]/g, ''), 10);
  if (Number.isInteger(index) && index >= 1 && index <= alternatives.length) {
    return alternatives[index - 1]?.label ?? null;
  }
  return null;
}
