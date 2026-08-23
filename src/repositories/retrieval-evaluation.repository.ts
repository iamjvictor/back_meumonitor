import { prisma } from '../lib/prisma.js';

export async function createRetrievalEvalCase(input: {
  teacherId: string;
  monitorId: string;
  subjectId: string;
  question: string;
  expectedBlockIds: string[];
  expectedChunkIds?: string[];
  expectedAnswerContains?: string[];
}) {
  return prisma.retrievalEvalCase.create({
    data: {
      teacherId: input.teacherId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      question: input.question,
      expectedBlockIds: input.expectedBlockIds,
      expectedChunkIds: input.expectedChunkIds ?? undefined,
      expectedAnswerContains: input.expectedAnswerContains ?? undefined,
    },
  });
}

export async function findRetrievalEvalCaseForRun(caseId: string) {
  return prisma.retrievalEvalCase.findFirst({
    where: { id: caseId, active: true },
    select: {
      id: true,
      teacherId: true,
      question: true,
      monitorId: true,
      subjectId: true,
      expectedBlockIds: true,
      expectedChunkIds: true,
    },
  });
}

export async function saveRetrievalEvalRun(input: {
  caseId: string;
  topK: number;
  returnedBlockIds: string[];
  returnedChunkIds: string[];
  recallAtK: number;
  reciprocalRank: number;
  contextPrecision: number;
  durationMs: number;
}) {
  return prisma.retrievalEvalRun.create({
    data: {
      caseId: input.caseId,
      topK: input.topK,
      returnedBlockIds: input.returnedBlockIds,
      returnedChunkIds: input.returnedChunkIds,
      recallAtK: input.recallAtK,
      reciprocalRank: input.reciprocalRank,
      contextPrecision: input.contextPrecision,
      durationMs: input.durationMs,
    },
  });
}

export async function findRetrievalEvalCases(input: {
  teacherId: string;
  monitorId: string;
  subjectId: string;
}) {
  return prisma.retrievalEvalCase.findMany({
    where: { ...input, active: true },
    orderBy: { createdAt: 'asc' },
  });
}
