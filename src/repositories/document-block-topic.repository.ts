import { prisma } from '../lib/prisma.js';

export type BlockTopicClassificationInput = {
  blockId: string;
  topicId: string | null;
  classificationMethod: 'INHERITED' | 'RULE' | 'LLM' | 'TEACHER';
  confidence: number | null;
  status: 'PENDING' | 'CLASSIFIED' | 'OUT_OF_SCOPE' | 'REJECTED';
  isPrimary: boolean;
};

export async function findBlockTopicClassificationData(documentId: string, documentTextId: string) {
  return prisma.monitorDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      subjectId: true,
      topicId: true,
      subject: {
        select: {
          monitorId: true,
          monitor: { select: { teacherId: true } },
        },
      },
      topicLinks: {
        select: {
          topic: {
            select: {
              id: true,
              name: true,
              definition: true,
              classificationGuidance: true,
              aiDefinition: true,
              aiClassificationGuidance: true,
            },
          },
        },
      },
      blocks: {
        where: { documentTextId, status: { not: 'FAILED' } },
        select: {
          id: true,
          blockIndex: true,
          type: true,
          title: true,
          normalizedContent: true,
          sectionPath: true,
        },
        orderBy: { blockIndex: 'asc' },
      },
    },
  });
}

export async function replaceBlockTopicClassifications(
  documentTextId: string,
  rows: BlockTopicClassificationInput[],
) {
  const blockIds = Array.from(new Set(rows.map((row) => row.blockId)));

  await prisma.$transaction(async (transaction) => {
    await transaction.documentBlockTopic.deleteMany({
      where: { blockId: { in: blockIds } },
    });

    if (rows.length > 0) {
      await transaction.documentBlockTopic.createMany({
        data: rows,
      });
    }
  });

  return {
    documentTextId,
    rowCount: rows.length,
    classifiedBlockCount: new Set(
      rows.filter((row) => row.status === 'CLASSIFIED').map((row) => row.blockId),
    ).size,
    outOfScopeBlockCount: new Set(
      rows.filter((row) => row.status === 'OUT_OF_SCOPE').map((row) => row.blockId),
    ).size,
  };
}

export async function markBlockTopicClassificationsPending(
  documentTextId: string,
) {
  const blocks = await prisma.documentBlock.findMany({
    where: { documentTextId, status: { not: 'FAILED' } },
    select: { id: true },
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.documentBlockTopic.deleteMany({
      where: { blockId: { in: blocks.map((block) => block.id) } },
    });

    if (blocks.length > 0) {
      await transaction.documentBlockTopic.createMany({
        data: blocks.map((block) => ({
          blockId: block.id,
          topicId: null,
          classificationMethod: 'LLM' as const,
          confidence: null,
          status: 'PENDING' as const,
          isPrimary: false,
        })),
      });
    }
  });

  return { documentTextId, blockCount: blocks.length };
}
