import { prisma } from '../lib/prisma.js';
import { computeFlashcardFrontHash } from '../services/flashcard-front-hash.js';
import { acquireDocumentAdvisoryLocks } from './document-advisory-lock.js';

export async function findFlashcardSourceBlocks(documentId: string) {
  return prisma.documentBlock.findMany({
    where: {
      documentId,
      status: { not: 'FAILED' },
      type: { in: ['DEFINITION', 'FORMULA', 'THEORY', 'EXAMPLE'] },
      topicLinks: { some: { status: 'CLASSIFIED', isPrimary: true, topicId: { not: null } } },
    },
    select: {
      id: true,
      blockIndex: true,
      type: true,
      title: true,
      normalizedContent: true,
      topicLinks: {
        where: { status: 'CLASSIFIED', topicId: { not: null } },
        select: {
          topicId: true,
          confidence: true,
          isPrimary: true,
          topic: { select: { id: true, name: true } },
        },
      },
      chunks: {
        where: { status: 'READY' },
        select: { id: true, chunkIndex: true },
        orderBy: { chunkIndexInBlock: 'asc' },
      },
    },
    orderBy: { blockIndex: 'asc' },
  });
}

export type FlashcardPersistenceInput = {
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId: string;
  front: string;
  back: string;
  kind: 'DEFINITION' | 'FORMULA' | 'RULE' | 'EXCEPTION' | 'APPLICATION';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
  generationOrigin?: 'AI_GENERATED';
  status?: 'PENDING_REVIEW';
  sourceChunkIds: string[];
};

export async function saveGeneratedFlashcards(rows: FlashcardPersistenceInput[]) {
  if (rows.some((row) => row.sourceChunkIds.length === 0)) {
    throw new Error('sourceChunkIds deve conter ao menos um chunk de origem.');
  }

  let savedCount = 0;
  let duplicateCount = 0;

  await prisma.$transaction(async (transaction) => {
    const sourceChunkIds = Array.from(new Set(rows.flatMap((row) => row.sourceChunkIds)));
    const sourceChunks = await transaction.documentChunk.findMany({
      where: { id: { in: sourceChunkIds } },
      select: { documentId: true },
    });
    await acquireDocumentAdvisoryLocks(transaction, sourceChunks.map((chunk) => chunk.documentId));

    for (const row of rows) {
      const frontHash = computeFlashcardFrontHash(row.front);
      const created = await transaction.flashcard.createMany({
        data: [{
          teacherId: row.teacherId,
          monitorId: row.monitorId,
          subjectId: row.subjectId,
          topicId: row.topicId,
          front: row.front,
          back: row.back,
          kind: row.kind,
          difficulty: row.difficulty,
          generationOrigin: row.generationOrigin ?? 'AI_GENERATED',
          status: row.status ?? 'PENDING_REVIEW',
          frontHash,
        }],
        skipDuplicates: true,
      });
      const flashcard = await transaction.flashcard.findUniqueOrThrow({
        where: { topicId_frontHash: { topicId: row.topicId, frontHash } },
        select: { id: true },
      });
      if (row.sourceChunkIds.length > 0) {
        await transaction.flashcardSource.createMany({
          data: row.sourceChunkIds.map((chunkId) => ({ flashcardId: flashcard.id, chunkId })),
          skipDuplicates: true,
        });
      }
      if (created.count === 0) duplicateCount += 1;
      else {
        savedCount += 1;
        console.log('Flashcard salvo para revisao', {
          event: 'monitor.flashcard_saved',
          flashcardId: flashcard.id,
          topicId: row.topicId,
          sourceChunkCount: row.sourceChunkIds.length,
        });
      }
    }
  });

  return { savedCount, duplicateCount };
}
