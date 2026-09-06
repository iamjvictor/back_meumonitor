import type { BoundingBox } from './document-parser/document-parser.types.js';
import type { QuestionAlternative } from './completeQuestion/question-completion.types.js';
import { renderQuestionContextPack } from './question-source-context.service.js';

export type QuestionContextAgent = 'RECONSTRUCTION' | 'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION' | 'AUDIT';

export type QuestionContextPack = {
  version: string;
  documentId: string;
  questionSpanId: string;
  questionSource: {
    statement: string;
    alternatives: QuestionAlternative[];
    sourceElementIds: string[];
    sourceChunkIds: string[];
  };
  answerKeySource?: {
    answer: string;
    confidence: number;
    sourceElementIds: string[];
    sourceChunkIds?: string[];
  };
  solutionSource?: {
    content: string;
    confidence: number;
    sourceElementIds: string[];
    sourceChunkIds?: string[];
  };
  conceptSupport: Array<{
    content: string;
    sourceChunkId: string;
    sourceBlockId: string;
    relevanceScore: number;
  }>;
  visuals: Array<{
    assetId: string;
    type: 'FIGURE' | 'TABLE' | 'FORMULA';
    pageNumber: number;
    bbox: BoundingBox;
    description?: string;
  }>;
  quality: {
    structuralStatus: string;
    mathLayoutStatus: string;
    warnings: string[];
  };
};

export type BuildQuestionContextPackInput = Omit<QuestionContextPack, 'version'> & {
  version?: string;
};

export async function buildQuestionContextPack(input: BuildQuestionContextPackInput): Promise<QuestionContextPack> {
  return {
    version: input.version ?? 'question-context-pack-v1',
    documentId: input.documentId,
    questionSpanId: input.questionSpanId,
    questionSource: {
      statement: input.questionSource.statement,
      alternatives: [...input.questionSource.alternatives],
      sourceElementIds: [...input.questionSource.sourceElementIds],
      sourceChunkIds: [...input.questionSource.sourceChunkIds],
    },
    answerKeySource: input.answerKeySource
      ? {
        answer: input.answerKeySource.answer,
        confidence: input.answerKeySource.confidence,
        sourceElementIds: [...input.answerKeySource.sourceElementIds],
        sourceChunkIds: input.answerKeySource.sourceChunkIds ? [...input.answerKeySource.sourceChunkIds] : undefined,
      }
      : undefined,
    solutionSource: input.solutionSource
      ? {
        content: input.solutionSource.content,
        confidence: input.solutionSource.confidence,
        sourceElementIds: [...input.solutionSource.sourceElementIds],
        sourceChunkIds: input.solutionSource.sourceChunkIds ? [...input.solutionSource.sourceChunkIds] : undefined,
      }
      : undefined,
    conceptSupport: input.conceptSupport.map((item) => ({ ...item })),
    visuals: input.visuals.map((visual) => ({ ...visual })),
    quality: {
      structuralStatus: input.quality.structuralStatus,
      mathLayoutStatus: input.quality.mathLayoutStatus,
      warnings: [...input.quality.warnings],
    },
  };
}

export function buildQuestionAgentContext(pack: QuestionContextPack, agent: QuestionContextAgent) {
  return renderQuestionContextPack(pack, agent);
}
