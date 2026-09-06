import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type PersistQuestionCandidateInput = {
  documentId: string;
  documentBlockId: string | null;
  sourceKey: string;
  questionNumber: string | null;
  chunkIds: string[];
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  statement: string;
  alternatives: Array<{ label: string; text: string }>;
  correctAnswer: string | null;
  explanation: string | null;
  spanStatus: 'ASSEMBLED' | 'VISUAL_PENDING' | 'READY_FOR_COMPLETION' | 'BLOCKED' | 'REVIEW_REQUIRED';
  visualStatus: 'NOT_REQUIRED' | 'PENDING_EXTRACTION' | 'MISSING';
  candidateStatus: 'ASSEMBLED' | 'VALIDATED' | 'VISUAL_PENDING' | 'READY_FOR_COMPLETION' | 'BLOCKED' | 'REVIEW_REQUIRED';
  structuralState: string;
  promotionReasons: string[];
  confidence: number;
  evidence: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
};

/**
 * Persiste a tentativa deterministica antes de qualquer IA. A chave vem do
 * documento/bloco/enunciado, por isso reprocessamentos atualizam a mesma
 * candidata em vez de criar questoes finais duplicadas.
 */
export async function upsertQuestionSpanCandidate(input: PersistQuestionCandidateInput) {
  return prisma.questionSpan.upsert({
    where: { sourceKey: input.sourceKey },
    create: {
      documentId: input.documentId,
      documentBlockId: input.documentBlockId,
      sourceKey: input.sourceKey,
      questionNumber: input.questionNumber,
      pageStart: input.pageStart,
      pageEnd: input.pageEnd,
      charStart: input.charStart,
      charEnd: input.charEnd,
      status: input.spanStatus,
      visualStatus: input.visualStatus,
      evidence: input.evidence,
      chunks: {
        create: input.chunkIds.map((chunkId, position) => ({ chunkId, position, role: 'PRIMARY' })),
      },
      candidate: {
        create: {
          statement: input.statement,
          alternatives: input.alternatives,
          correctAnswer: input.correctAnswer,
          explanation: input.explanation,
          originType: 'DETERMINISTIC',
          status: input.candidateStatus,
          promotionReasons: input.promotionReasons,
          structuralState: input.structuralState,
          confidence: input.confidence,
          metadata: input.metadata,
        },
      },
    },
    update: {
      documentBlockId: input.documentBlockId,
      questionNumber: input.questionNumber,
      pageStart: input.pageStart,
      pageEnd: input.pageEnd,
      charStart: input.charStart,
      charEnd: input.charEnd,
      status: input.spanStatus,
      visualStatus: input.visualStatus,
      evidence: input.evidence,
      chunks: {
        deleteMany: {},
        create: input.chunkIds.map((chunkId, position) => ({ chunkId, position, role: 'PRIMARY' })),
      },
      candidate: {
        upsert: {
          create: {
            statement: input.statement,
            alternatives: input.alternatives,
            correctAnswer: input.correctAnswer,
            explanation: input.explanation,
            originType: 'DETERMINISTIC',
            status: input.candidateStatus,
            promotionReasons: input.promotionReasons,
            structuralState: input.structuralState,
            confidence: input.confidence,
            metadata: input.metadata,
          },
          update: {
            statement: input.statement,
            alternatives: input.alternatives,
            correctAnswer: input.correctAnswer,
            explanation: input.explanation,
            status: input.candidateStatus,
            promotionReasons: input.promotionReasons,
            structuralState: input.structuralState,
            confidence: input.confidence,
            metadata: input.metadata,
          },
        },
      },
    },
    select: { id: true, status: true, candidate: { select: { id: true, status: true } } },
  });
}

export async function markQuestionCandidatePromoted(sourceKey: string) {
  return prisma.questionSpan.update({
    where: { sourceKey },
    data: {
      status: 'READY_FOR_COMPLETION',
      candidate: { update: { status: 'PROMOTED' } },
    },
  });
}
