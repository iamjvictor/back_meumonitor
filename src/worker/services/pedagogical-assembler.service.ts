import { createHash } from 'node:crypto';
import type { BoundingBox, LayoutDocument, LayoutElement } from './document-parser/document-parser.types.js';
import { normalizeLayoutContent, isCorruptedLatex } from './layout-content-normalizer.service.js';
import { assessQuestionQuality, validateQuestionStructure } from './question-quality.service.js';
import type { QuestionAlternative } from './completeQuestion/question-completion.types.js';

export type PedagogicalRole =
  | 'SECTION_TITLE'
  | 'QUESTION_MARKER'
  | 'QUESTION_STATEMENT'
  | 'ALTERNATIVE'
  | 'ANSWER_KEY'
  | 'SOLUTION'
  | 'THEORY'
  | 'WORKED_EXAMPLE'
  | 'TEACHER_GUIDANCE'
  | 'VISUAL_EVIDENCE'
  | 'EDITORIAL_NOISE'
  | 'UNKNOWN';

export type MathLayoutStatus = 'NOT_APPLICABLE' | 'VALID' | 'UNCERTAIN' | 'CORRUPTED' | 'REQUIRES_VISUAL_PARSE';

export type QuestionSpanVisual = {
  assetId: string;
  type: 'FIGURE' | 'TABLE' | 'FORMULA';
  pageNumber: number;
  bbox: BoundingBox;
  description?: string;
};

export type QuestionSpanAssembly = {
  questionSpanId: string;
  documentId: string;
  questionNumber: string | null;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  sourceElementIds: string[];
  questionSource: {
    statement: string;
    alternatives: QuestionAlternative[];
    sourceElementIds: string[];
  };
  answerKeySource?: {
    answer: string;
    confidence: number;
    sourceElementIds: string[];
  };
  solutionSource?: {
    content: string;
    confidence: number;
    sourceElementIds: string[];
  };
  visuals: QuestionSpanVisual[];
  quality: {
    structuralStatus: 'VALID' | 'INCOMPLETE' | 'CONTAMINATED';
    mathLayoutStatus: MathLayoutStatus;
    warnings: string[];
  };
};

type WorkingSpan = {
  documentId: string;
  questionNumber: string | null;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  sourceElementIds: string[];
  statementParts: string[];
  alternatives: QuestionAlternative[];
  answerKeySource?: {
    answer: string;
    confidence: number;
    sourceElementIds: string[];
  };
  solutionSource?: {
    content: string;
    confidence: number;
    sourceElementIds: string[];
  };
  visuals: QuestionSpanVisual[];
  mathLayoutStatus: MathLayoutStatus;
  warnings: string[];
  firstQuestionElementId: string | null;
};

const QUESTION_MARKER = /^(?:quest[aã]o\s*)?(\d{1,3})[.)]\s*(.*)$/iu;
const ALTERNATIVE_MARKER = /^([A-E])[.)]\s*(.*)$/iu;
const ANSWER_KEY_MARKER = /(?:gabarito|resposta)\s*[:\-]?\s*([A-E])/iu;
const SOLUTION_MARKER = /(?:solu[cç][aã]o|resolu[cç][aã]o)\s*[:\-]?\s*(.+)$/iu;
const SECTION_TITLE = new Set(['TITLE']);
const VISUAL_CATEGORIES = new Set(['FIGURE', 'TABLE', 'FORMULA']);

export function assembleQuestionSpan(document: LayoutDocument): QuestionSpanAssembly[] {
  const normalized = normalizeLayoutContent(document);
  const elements = [...normalized.semanticElements].sort(compareElements);
  const assemblies: QuestionSpanAssembly[] = [];
  let sectionPath: string[] = [];
  let activeSpan: WorkingSpan | null = null;

  for (const element of elements) {
    if (SECTION_TITLE.has(element.category)) {
      sectionPath = [normalizeText(element)];
      continue;
    }

    const text = normalizeText(element);
    if (!text) {
      if (isVisualElement(element)) {
        attachVisual(activeSpan, element);
      }
      continue;
    }

    const questionMatch = text.match(QUESTION_MARKER);
    if (questionMatch) {
      if (activeSpan) assemblies.push(finalizeSpan(activeSpan));
      activeSpan = createSpan(document.documentId, sectionPath, element, questionMatch[1] ?? null, questionMatch[2] ?? '');
      continue;
    }

    if (!activeSpan) continue;
    activeSpan.sourceElementIds.push(element.id);
    activeSpan.pageEnd = Math.max(activeSpan.pageEnd, element.pageNumber);

    const alternativeMatch = text.match(ALTERNATIVE_MARKER);
    if (alternativeMatch) {
      activeSpan.alternatives.push({ label: alternativeMatch[1]!.toUpperCase(), text: alternativeMatch[2]!.trim() });
      continue;
    }

    const answerMatch = text.match(ANSWER_KEY_MARKER);
    if (answerMatch) {
      activeSpan.answerKeySource = {
        answer: answerMatch[1]!.toUpperCase(),
        confidence: 1,
        sourceElementIds: [element.id],
      };
      continue;
    }

    const solutionMatch = text.match(SOLUTION_MARKER);
    if (solutionMatch) {
      activeSpan.solutionSource = {
        content: solutionMatch[1]!.trim(),
        confidence: 0.95,
        sourceElementIds: [element.id],
      };
      continue;
    }

    if (isVisualElement(element)) {
      activeSpan.mathLayoutStatus = updateMathLayoutStatus(activeSpan.mathLayoutStatus, element);
      attachVisual(activeSpan, element);
      continue;
    }

    if (activeSpan.alternatives.length > 0 && !looksLikeQuestionContinuation(text)) {
      continue;
    }

    activeSpan.statementParts.push(stripQuestionMarker(text, activeSpan.firstQuestionElementId !== element.id));
    activeSpan.mathLayoutStatus = updateMathLayoutStatus(activeSpan.mathLayoutStatus, element);
  }

  if (activeSpan) assemblies.push(finalizeSpan(activeSpan));
  return assemblies;
}

function createSpan(
  documentId: string,
  sectionPath: string[],
  element: LayoutElement,
  questionNumber: string | null,
  remainder: string,
): WorkingSpan {
  const text = remainder.trim();
  return {
    documentId,
    questionNumber,
    sectionPath: [...sectionPath],
    pageStart: element.pageNumber,
    pageEnd: element.pageNumber,
    sourceElementIds: [element.id],
    statementParts: [text || normalizeText(element)],
    alternatives: [],
    visuals: [],
    mathLayoutStatus: isCorruptedLatex(element.latex) ? 'CORRUPTED' : 'NOT_APPLICABLE',
    warnings: [],
    firstQuestionElementId: element.id,
  };
}

function finalizeSpan(span: WorkingSpan): QuestionSpanAssembly {
  const statement = compact(span.statementParts.join(' '));
  const structural = validateQuestionStructure({ text: statement, alternatives: span.alternatives });
  const incomplete = !statement || span.alternatives.length !== 5;
  const contaminated = structural.reasons.some((reason) => reason === 'CONTAMINATED_ALTERNATIVES' || reason === 'MULTIPLE_QUESTIONS');
  const quality: QuestionSpanAssembly['quality'] = {
    structuralStatus: !incomplete && !contaminated ? 'VALID' : contaminated ? 'CONTAMINATED' : 'INCOMPLETE',
    mathLayoutStatus: span.mathLayoutStatus,
    warnings: [...span.warnings],
  };

  if (span.mathLayoutStatus === 'CORRUPTED') {
    quality.warnings.push('FORMULA_CORRUPTED');
  }

  return {
    questionSpanId: buildQuestionSpanId(span.documentId, span.sectionPath, span.questionNumber, span.sourceElementIds),
    documentId: span.documentId,
    questionNumber: span.questionNumber,
    sectionPath: [...span.sectionPath],
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sourceElementIds: [...span.sourceElementIds],
    questionSource: {
      statement,
      alternatives: span.alternatives.map((alternative) => ({ ...alternative })),
      sourceElementIds: [...span.sourceElementIds],
    },
    answerKeySource: span.answerKeySource ? { ...span.answerKeySource, sourceElementIds: [...span.answerKeySource.sourceElementIds] } : undefined,
    solutionSource: span.solutionSource ? { ...span.solutionSource, sourceElementIds: [...span.solutionSource.sourceElementIds] } : undefined,
    visuals: span.visuals.map((visual) => ({ ...visual, bbox: { ...visual.bbox } })),
    quality,
  };
}

function updateMathLayoutStatus(current: MathLayoutStatus, element: LayoutElement): MathLayoutStatus {
  if (element.category !== 'FORMULA') return current;
  if (isCorruptedLatex(element.latex)) return 'CORRUPTED';
  return current === 'NOT_APPLICABLE' ? 'VALID' : current;
}

function attachVisual(span: WorkingSpan | null, element: LayoutElement) {
  if (!span) return;
  const assetType = element.category === 'FIGURE' ? 'FIGURE' : element.category === 'TABLE' ? 'TABLE' : 'FORMULA';
  const assetIds = element.assetIds.length > 0 ? element.assetIds : [element.id];
  for (const assetId of assetIds) {
    span.visuals.push({
      assetId,
      type: assetType,
      pageNumber: element.pageNumber,
      bbox: element.bbox,
      description: compact(normalizeText(element)) || undefined,
    });
  }
  span.warnings.push('VISUAL_EVIDENCE');
}

function isVisualElement(element: LayoutElement) {
  return VISUAL_CATEGORIES.has(element.category) || element.assetIds.length > 0;
}

function normalizeText(element: LayoutElement) {
  return compact((element.normalizedText ?? element.rawText ?? '').trim());
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripQuestionMarker(text: string, keepText: boolean) {
  if (keepText) return text;
  const match = text.match(QUESTION_MARKER);
  return match ? match[2]?.trim() ?? '' : text;
}

function looksLikeQuestionContinuation(text: string) {
  return /[?!.:]$/.test(text) || /\b(?:gabarito|solu[cç][aã]o|resolu[cç][aã]o)\b/i.test(text);
}

function compareElements(left: LayoutElement, right: LayoutElement) {
  const leftColumn = left.columnIndex ?? 0;
  const rightColumn = right.columnIndex ?? 0;
  return left.pageNumber - right.pageNumber
    || leftColumn - rightColumn
    || left.readingOrder - right.readingOrder
    || left.id.localeCompare(right.id);
}

function buildQuestionSpanId(documentId: string, sectionPath: string[], questionNumber: string | null, sourceElementIds: string[]) {
  return createHash('sha1')
    .update([documentId, sectionPath.join('>'), questionNumber ?? '', ...sourceElementIds].join('|'))
    .digest('hex')
    .slice(0, 24);
}
