import { QuestionAlternativesAgentService } from './question-alternatives-agent.service.js';
import { QuestionAnswerAgentService } from './question-answer-agent.service.js';
import { QuestionExplanationAgentService } from './question-explanation-agent.service.js';
import type { CompletedQuestion, QuestionCompletionInput } from './question-completion.types.js';

export class QuestionCompletionService {
  constructor(
    private readonly alternativesAgent = new QuestionAlternativesAgentService(),
    private readonly answerAgent = new QuestionAnswerAgentService(),
    private readonly explanationAgent = new QuestionExplanationAgentService(),
  ) {}

  async complete(input: QuestionCompletionInput): Promise<CompletedQuestion> {
    const alternatives = await this.alternativesAgent.complete(input);
    const resolvedAlternatives = alternatives.alternatives;

    const answer = resolvedAlternatives.length > 0
      ? await this.answerAgent.complete(
        { ...input, alternatives: resolvedAlternatives },
        resolvedAlternatives,
      )
      : {
        correctAnswer: null,
        generated: false,
        usedDocumentRag: false,
        decisionSource: null,
        generation: undefined,
        failure: undefined,
      } as const;

    const sourceExplanation = input.explanation?.trim();
    const explanation = sourceExplanation && sourceExplanation.length >= 10
      ? { explanation: sourceExplanation, generated: false }
      : await this.explanationAgent.complete({
        ...input,
        alternatives: resolvedAlternatives,
        correctAnswer: answer.correctAnswer,
      });
    // O agente de resposta valida o gabarito documental contra as alternativas.
    // Nunca persista o valor bruto da fonte quando ele não puder ser convertido
    // em A–E: ele pode ser rodapé, referência ou resposta de outra questão.
    const correctAnswer = answer.correctAnswer;
    const resolvedExplanation = explanation.explanation ?? sourceExplanation ?? null;
    const missingFields = [
      ...(resolvedAlternatives.length === 5 ? [] : ['alternatives']),
      ...(
        correctAnswer
        && resolvedAlternatives.some((alternative) => alternative.label === correctAnswer)
          ? []
          : ['correctAnswer']
      ),
      ...(resolvedExplanation && resolvedExplanation.length >= 10 ? [] : ['explanation']),
    ];
    const failedAgents = [
      ...(alternatives.failure ? ['ALTERNATIVES' as const] : []),
      ...(answer.failure ? ['CORRECT_ANSWER' as const] : []),
      ...(explanation.failure ? ['EXPLANATION' as const] : []),
    ];

    if (missingFields.length > 0) {
      console.log('Conclusao parcial da questao sera salva para revisao', {
        event: 'monitor.question_completion_partial_for_review',
        documentId: input.documentId,
        sourceBlockId: input.sourceBlockId,
        missingFields,
        failedAgents,
      });
    }

    return {
      alternatives: resolvedAlternatives,
      correctAnswer,
      explanation: resolvedExplanation,
      alternativesGenerated: alternatives.generated,
      answerGenerated: answer.generated,
      explanationGenerated: explanation.generated,
      answerUsedDocumentRag: answer.usedDocumentRag,
      answerDecisionSource: answer.decisionSource,
      generations: [alternatives.generation, answer.generation, explanation.generation]
        .filter((generation): generation is NonNullable<typeof generation> => Boolean(generation)),
      missingFields,
      failedAgents,
      agentFailures: [alternatives.failure, answer.failure, explanation.failure]
        .filter((failure): failure is NonNullable<typeof failure> => Boolean(failure)),
    };
  }
}
