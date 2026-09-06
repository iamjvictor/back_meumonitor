import { requiresMissingFigure } from './question-quality.service.js';
import type { MathLayoutStatus, QuestionSpanAssembly } from './pedagogical-assembler.service.js';

export type PromotionDecision = {
  status: 'READY_FOR_COMPLETION' | 'BLOCKED' | 'REVIEW_REQUIRED';
  reasons: string[];
  warnings: string[];
  mathLayoutStatus: MathLayoutStatus;
  evidenceIds: string[];
};

export function canPromoteQuestion(input: QuestionSpanAssembly): PromotionDecision {
  const reasons = new Set<string>();
  const warnings = new Set<string>(input.quality.warnings);
  const questionText = input.questionSource.statement;
  if (input.quality.structuralStatus !== 'VALID') {
    reasons.add(input.quality.structuralStatus);
  }

  if (input.quality.mathLayoutStatus === 'CORRUPTED') {
    reasons.add('CORRUPTED_FORMULA');
  }

  const visualReferenceMissing = requiresMissingFigure(questionText, input.visuals.length > 0);
  if (visualReferenceMissing && input.visuals.length === 0) {
    reasons.add('MISSING_VISUAL_EVIDENCE');
  }

  const status = reasons.has('CORRUPTED_FORMULA')
    || reasons.has('MISSING_VISUAL_EVIDENCE')
    || reasons.has('INCOMPLETE')
    || reasons.has('CONTAMINATED_ALTERNATIVES')
    || reasons.has('MULTIPLE_QUESTIONS')
    ? 'BLOCKED'
    : input.quality.structuralStatus === 'VALID'
      ? 'READY_FOR_COMPLETION'
      : 'REVIEW_REQUIRED';

  return {
    status,
    reasons: [...reasons],
    warnings: [...warnings],
    mathLayoutStatus: input.quality.mathLayoutStatus,
    evidenceIds: [
      ...input.sourceElementIds,
      ...input.visuals.map((visual) => visual.assetId),
    ],
  };
}
