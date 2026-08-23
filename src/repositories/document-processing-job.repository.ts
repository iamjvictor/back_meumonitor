import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const DOCUMENT_PROCESSING_VERSION = 4;

export const DOCUMENT_PROCESSING_OPERATIONS = [
  'EXTRACT_TEXT',
  'NORMALIZE_TEXT',
  'DETECT_BLOCKS',
  'CLASSIFY_BLOCKS',
  'CREATE_RETRIEVAL_CHUNKS',
  'GENERATE_CHUNK_EMBEDDINGS',
  'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
  'MATCH_ANSWER_KEYS',
  'GENERATE_FLASHCARD_CANDIDATES',
  'READY_FOR_REVIEW',
] as const;

export type DocumentProcessingOperation = typeof DOCUMENT_PROCESSING_OPERATIONS[number];

function idempotencyKey(documentId: string, operation: DocumentProcessingOperation) {
  return ['document', documentId, 'version', DOCUMENT_PROCESSING_VERSION, 'operation', operation].join(':');
}

export async function ensureDocumentProcessingJobs(documentId: string) {
  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { processingVersion: DOCUMENT_PROCESSING_VERSION },
  });

  await prisma.documentProcessingJob.createMany({
    data: DOCUMENT_PROCESSING_OPERATIONS.map((operation) => ({
      documentId,
      operation,
      processingVersion: DOCUMENT_PROCESSING_VERSION,
      idempotencyKey: idempotencyKey(documentId, operation),
      status: 'QUEUED' as const,
    })),
    skipDuplicates: true,
  });
}

export async function findDocumentProcessingStatus(
  userId: string,
  monitorId: string,
  documentId: string,
) {
  return prisma.monitorDocument.findFirst({
    where: {
      id: documentId,
      monitorId,
      monitor: { teacher: { userId } },
    },
    select: {
      id: true,
      monitorId: true,
      subjectId: true,
      tag: true,
      status: true,
      processingVersion: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      processingJobs: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          operation: true,
          processingVersion: true,
          status: true,
          attempts: true,
          outputSummary: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function startDocumentProcessingJob(
  documentId: string,
  operation: DocumentProcessingOperation,
  inputSnapshot?: Prisma.InputJsonValue,
) {
  const key = idempotencyKey(documentId, operation);
  return prisma.documentProcessingJob.upsert({
    where: { idempotencyKey: key },
    create: {
      documentId,
      operation,
      processingVersion: DOCUMENT_PROCESSING_VERSION,
      idempotencyKey: key,
      status: 'PROCESSING',
      attempts: 1,
      inputSnapshot,
      startedAt: new Date(),
    },
    update: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
      inputSnapshot,
      outputSummary: Prisma.JsonNull,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    },
  });
}

export async function completeDocumentProcessingJob(
  documentId: string,
  operation: DocumentProcessingOperation,
  outputSummary?: Prisma.InputJsonValue,
) {
  return prisma.documentProcessingJob.update({
    where: { idempotencyKey: idempotencyKey(documentId, operation) },
    data: { status: 'READY', outputSummary, errorMessage: null, finishedAt: new Date() },
  });
}

export async function failDocumentProcessingJob(
  documentId: string,
  operation: DocumentProcessingOperation,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  return prisma.documentProcessingJob.update({
    where: { idempotencyKey: idempotencyKey(documentId, operation) },
    data: { status: 'FAILED', errorMessage: message.slice(0, 2000), finishedAt: new Date() },
  });
}

export async function skipDocumentProcessingJob(
  documentId: string,
  operation: DocumentProcessingOperation,
  outputSummary?: Prisma.InputJsonValue,
) {
  return prisma.documentProcessingJob.update({
    where: { idempotencyKey: idempotencyKey(documentId, operation) },
    data: { status: 'SKIPPED', outputSummary, finishedAt: new Date() },
  });
}
