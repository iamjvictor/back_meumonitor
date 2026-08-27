import { prisma } from '../lib/prisma.js';
import { computeFlashcardFrontHash } from '../services/flashcard-front-hash.js';

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
  sourceChunkIds: string[];
};

export async function saveGeneratedFlashcards(rows: FlashcardPersistenceInput[]) {
  let savedCount = 0;
  let duplicateCount = 0;

  await prisma.$transaction(async (transaction) => {
    for (const row of rows) {
      const frontHash = computeFlashcardFrontHash(row.front);
      const existing = await transaction.flashcard.findUnique({
        where: { topicId_frontHash: { topicId: row.topicId, frontHash } },
        select: { id: true },
      });

      if (existing) {
        duplicateCount += 1;
        continue;
      }

      const flashcard = await transaction.flashcard.create({
        data: {
          teacherId: row.teacherId,
          monitorId: row.monitorId,
          subjectId: row.subjectId,
          topicId: row.topicId,
          front: row.front,
          back: row.back,
          kind: row.kind,
          difficulty: row.difficulty,
          generationOrigin: 'AI_GENERATED',
          status: 'PENDING_REVIEW',
          frontHash,
          sources: row.sourceChunkIds.length > 0
            ? { createMany: { data: row.sourceChunkIds.map((chunkId) => ({ chunkId })) } }
            : undefined,
        },
        select: { id: true },
      });
      savedCount += 1;
      console.log('Flashcard salvo para revisao', {
        event: 'monitor.flashcard_saved',
        flashcardId: flashcard.id,
        topicId: row.topicId,
        sourceChunkCount: row.sourceChunkIds.length,
      });
    }
  });

  return { savedCount, duplicateCount };
}
