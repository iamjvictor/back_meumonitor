export type QuestionQualityReason =
  | 'MISSING_ALTERNATIVES'
  | 'INVALID_ALTERNATIVES'
  | 'CONTAMINATED_ALTERNATIVES'
  | 'MULTIPLE_QUESTIONS'
  | 'INCOMPLETE_STATEMENT'
  | 'MISSING_ANSWER'
  | 'INVALID_ANSWER'
  | 'MISSING_EXPLANATION'
  | 'ANSWER_EXPLANATION_CONTRADICTION'
  | 'MISSING_FIGURE'
  | 'DUPLICATE'
  | 'ALTERNATIVES_GENERATED'
  | 'ANSWER_GENERATED'
  | 'EXPLANATION_GENERATED'
  | 'NON_QUESTION_BLOCK'
  | 'REQUIRES_REEXTRACTION'
  | 'AI_REVIEW_FAILED';

export type QuestionQualitySeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type RecommendedAction = 'REVIEW' | 'CORRECT' | 'REPROCESS' | 'DUPLICATE' | 'KEEP';
export type QuestionRecommendedAction = RecommendedAction;
export type QuestionProcessingState =
  | 'EXTRACTED'
  | 'STRUCTURALLY_VALID'
  | 'CONVERTIBLE_TO_MULTIPLE_CHOICE'
  | 'AI_COMPLETED'
  | 'AI_REVIEWED'
  | 'PENDING_REVIEW'
  | 'STRUCTURALLY_INVALID'
  | 'AI_REVIEW_FAILED';

export type StructuralValidation = {
  valid: boolean;
  convertible: boolean;
  processingState: Extract<QuestionProcessingState, 'STRUCTURALLY_VALID' | 'CONVERTIBLE_TO_MULTIPLE_CHOICE' | 'STRUCTURALLY_INVALID'>;
  reasons: QuestionQualityReason[];
  recommendedAction: RecommendedAction;
};

export type QuestionQualityAssessment = {
  score: number;
  reasons: QuestionQualityReason[];
  severity: QuestionQualitySeverity;
  recommendedAction: QuestionRecommendedAction;
  structuralValid: boolean;
  semanticValid: boolean;
  mathConsistencyChecked: boolean;
  mathConsistencyValid: boolean;
};

type AssessmentInput = {
  text: string;
  alternatives: Array<{ label: string; text: string }>;
  correctAnswer: string | null;
  explanation: string | null;
  sourceContext?: string;
  generatedAlternatives?: boolean;
  generatedCorrectAnswer?: boolean;
  generatedExplanation?: boolean;
  visualEvidenceAvailable?: boolean;
};

const QUESTION_MARKER = /(?:quest[aã]o|exerc[ií]cio|problema)\s*\d{1,3}/giu;
const QUESTION_NUMBER_AFTER_PUNCTUATION = /[?!.]\s+\d{1,3}[.)]\s+(?=[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ])/gu;
const EXAMPLE_MARKER = /\bex\.?\s*\d{1,3}\b/giu;
const CONTAMINATION = /(?:quest[aã]o|exerc[ií]cio|problema)\s*\d{1,3}|alternativa\s+[A-E]\s*[).:;-]|(?:resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b/iu;
const FIGURE_REFERENCE = /\b(?:figura|imagem|ilustra[cç][aã]o|ao lado|conforme ilustrado|observe abaixo)\b/iu;
const QUESTION_INTENT = /\?|\b(?:calcule|calcular|determine|qual|quanto|quantos|quantas|resolva|considere|assinale|avalie|identifique|obtenha|encontre|explique)\b/iu;
// Dois-pontos no fim do enunciado são válidos quando introduzem alternativas.
const INCOMPLETE_ENDING = /\b(?:e|ou|que|de|da|do|dos|das|para|com|a|o|os|as|em|por)\s*$/iu;
const TRAILING_ENUMERATION = /\b[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ](?:\s*,\s*[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ])+\s+e\s*$/u;

function hasFiveAlternatives(alternatives: AssessmentInput['alternatives']) {
  const labels = alternatives.map((alternative) => alternative.label.toUpperCase());
  return alternatives.length === 5
    && labels.join('') === 'ABCDE'
    && alternatives.every((alternative) => alternative.text.trim().length > 0);
}

export function validateQuestionStructure(input: Pick<AssessmentInput, 'text' | 'alternatives'>): StructuralValidation {
  const reasons = new Set<QuestionQualityReason>();
  const text = input.text.replace(/\s+/g, ' ').trim();
  const alternatives = input.alternatives;

  // Enunciados de multipla escolha podem ser declarativos (por exemplo,
  // "a distancia percorrida e:" ou "a aceleracao vale:") e ainda assim
  // constituirem uma pergunta completa quando as alternativas A-E estao
  // presentes. Nesses casos, a estrutura das alternativas e a evidencia de
  // origem distinguem a questao de um titulo ou rotulo de secao.
  const completeMultipleChoice = hasFiveAlternatives(alternatives);
  if (text.length < 40 || (!QUESTION_INTENT.test(text) && !completeMultipleChoice)) {
    reasons.add('NON_QUESTION_BLOCK');
  }
  if (INCOMPLETE_ENDING.test(text) || TRAILING_ENUMERATION.test(text)) reasons.add('INCOMPLETE_STATEMENT');

  const namedQuestionCount = [...text.matchAll(QUESTION_MARKER)].length;
  const numberedQuestionCount = [...text.matchAll(QUESTION_NUMBER_AFTER_PUNCTUATION)].length;
  const exampleCount = [...text.matchAll(EXAMPLE_MARKER)].length;
  if (namedQuestionCount > 1 || numberedQuestionCount > 0 || exampleCount > 0) {
    reasons.add('MULTIPLE_QUESTIONS');
  }

  if (alternatives.some((alternative) => CONTAMINATION.test(alternative.text))) {
    reasons.add('CONTAMINATED_ALTERNATIVES');
  }

  const complete = hasFiveAlternatives(alternatives);
  if (!complete) {
    if (alternatives.length === 0) reasons.add('MISSING_ALTERNATIVES');
    else reasons.add('INVALID_ALTERNATIVES');
  }

  const hardInvalid = reasons.has('NON_QUESTION_BLOCK')
    || reasons.has('INCOMPLETE_STATEMENT')
    || reasons.has('MULTIPLE_QUESTIONS')
    || reasons.has('CONTAMINATED_ALTERNATIVES');
  const convertible = !hardInvalid && !complete;
  const valid = !hardInvalid && complete;
  const recommendedAction: RecommendedAction = hardInvalid
    ? 'REPROCESS'
    : convertible ? 'CORRECT' : 'REVIEW';

  return {
    valid,
    convertible,
    processingState: hardInvalid
      ? 'STRUCTURALLY_INVALID'
      : convertible ? 'CONVERTIBLE_TO_MULTIPLE_CHOICE' : 'STRUCTURALLY_VALID',
    reasons: [...reasons],
    recommendedAction,
  };
}

/**
 * O texto extraído de um PDF não carrega o conteúdo visual da página. Portanto,
 * quando a pergunta depende explicitamente de uma figura, não há evidência
 * suficiente para a IA completar ou corrigir a resposta com segurança.
 */
export function requiresMissingFigure(text: string, visualEvidenceAvailable = false) {
  return FIGURE_REFERENCE.test(text) && !visualEvidenceAvailable;
}

export function assessQuestionQuality(input: AssessmentInput): QuestionQualityAssessment {
  const reasons = new Set<QuestionQualityReason>(validateQuestionStructure(input).reasons);
  let score = 100;
  const labels = input.alternatives.map((alternative) => alternative.label.toUpperCase());
  const complete = hasFiveAlternatives(input.alternatives);

  if (reasons.has('NON_QUESTION_BLOCK')) score -= 35;
  if (!complete) score -= 35;
  if (reasons.has('CONTAMINATED_ALTERNATIVES')) score -= 30;
  if (reasons.has('MULTIPLE_QUESTIONS')) score -= 35;
  if (reasons.has('INCOMPLETE_STATEMENT')) score -= 35;

  const answer = input.correctAnswer?.trim().toUpperCase() ?? '';
  if (!/^[A-E]$/.test(answer)) {
    reasons.add('MISSING_ANSWER');
    score -= 25;
  } else if (!labels.includes(answer)) {
    reasons.add('INVALID_ANSWER');
    score -= 30;
  }

  const explanation = input.explanation?.trim() ?? '';
  if (explanation.length < 10) {
    reasons.add('MISSING_EXPLANATION');
    score -= 15;
  }
  const explanationAnswer = extractExplicitAnswerFromExplanation(explanation);
  if (answer && explanationAnswer && answer !== explanationAnswer) {
    reasons.add('ANSWER_EXPLANATION_CONTRADICTION');
    score -= 40;
  }
  if (requiresMissingFigure(input.text, input.visualEvidenceAvailable)) {
    reasons.add('MISSING_FIGURE');
    score -= 20;
  }
  if (input.generatedAlternatives) { reasons.add('ALTERNATIVES_GENERATED'); score -= 8; }
  if (input.generatedCorrectAnswer) { reasons.add('ANSWER_GENERATED'); score -= 8; }
  if (input.generatedExplanation) { reasons.add('EXPLANATION_GENERATED'); score -= 4; }

  const reasonList = [...reasons];
  const criticalReasons = new Set<QuestionQualityReason>([
    'MULTIPLE_QUESTIONS', 'CONTAMINATED_ALTERNATIVES', 'INCOMPLETE_STATEMENT',
    'ANSWER_EXPLANATION_CONTRADICTION', 'MISSING_FIGURE', 'NON_QUESTION_BLOCK',
  ]);
  const structuralValid = complete && !reasonList.some((reason) => [
    'MULTIPLE_QUESTIONS', 'CONTAMINATED_ALTERNATIVES', 'INCOMPLETE_STATEMENT', 'NON_QUESTION_BLOCK',
  ].includes(reason));
  const semanticValid = !reasonList.includes('ANSWER_EXPLANATION_CONTRADICTION') && !reasonList.includes('INVALID_ANSWER');
  const hasCriticalReason = reasonList.some((reason) => criticalReasons.has(reason));
  const severity: QuestionQualitySeverity = hasCriticalReason ? 'CRITICAL' : reasonList.length > 0 ? 'WARNING' : 'INFO';
  const recommendedAction: RecommendedAction = reasonList.includes('DUPLICATE')
    ? 'DUPLICATE'
    : reasonList.includes('MISSING_FIGURE')
      ? 'REPROCESS'
    : hasCriticalReason
      ? (reasonList.includes('MULTIPLE_QUESTIONS') || reasonList.includes('CONTAMINATED_ALTERNATIVES') || reasonList.includes('INCOMPLETE_STATEMENT') ? 'REPROCESS' : 'CORRECT')
      : reasonList.length > 0 ? 'REVIEW' : 'KEEP';

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: reasonList,
    severity,
    recommendedAction,
    structuralValid,
    semanticValid,
    mathConsistencyChecked: Boolean(explanation),
    mathConsistencyValid: !reasonList.includes('ANSWER_EXPLANATION_CONTRADICTION'),
  };
}

export function normalizedQuestionKey(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function extractExplicitAnswerFromExplanation(explanation: string | null | undefined) {
  return explanation?.match(/\b(?:alternativa|op[cç][aã]o)(?:\s+(?:correta|incorreta))?\s*(?::|é|e)?\s*(?:a\s*)?([A-E])\b/iu)?.[1]?.toUpperCase() ?? null;
}

export function isValidAnswerLabel(answer: string | null | undefined): answer is string {
  return /^[A-E]$/u.test(answer?.trim().toUpperCase() ?? '');
}
