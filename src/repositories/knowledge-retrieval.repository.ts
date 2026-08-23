import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type KnowledgeSearchInput = {
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId?: string;
  queryEmbedding: number[];
  limit?: number;
};

export type KnowledgeSearchCandidate = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  chunkIndex: number;
  similarity: number;
  content: string;
};

export async function searchReadyKnowledgeChunks(input: KnowledgeSearchInput) {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 50);
  const topicFilter = input.topicId
    ? Prisma.sql`AND EXISTS (
        SELECT 1
        FROM document_chunk_topics dct
        WHERE dct.chunk_id = dc.id
          AND dct.topic_id = ${input.topicId}::uuid
      )`
    : Prisma.empty;

  return prisma.$queryRaw<KnowledgeSearchCandidate[]>(Prisma.sql`
    SELECT
      dc.id AS "chunkId",
      dc.document_id AS "documentId",
      dc.block_id AS "blockId",
      dc.chunk_index AS "chunkIndex",
      1 - (
        dc.embedding::extensions.halfvec(2048)
        <=> ${JSON.stringify(input.queryEmbedding)}::extensions.halfvec(2048)
      ) AS similarity,
      dc.content
    FROM document_chunks dc
    WHERE dc.teacher_id = ${input.teacherId}::uuid
      AND dc.monitor_id = ${input.monitorId}::uuid
      AND dc.subject_id = ${input.subjectId}::uuid
      AND dc.status = 'READY'::"ChunkStatus"
      AND dc.embedding IS NOT NULL
      ${topicFilter}
    ORDER BY dc.embedding::extensions.halfvec(2048)
      <=> ${JSON.stringify(input.queryEmbedding)}::extensions.halfvec(2048)
    LIMIT ${limit}
  `);
}

export async function loadKnowledgeContext(
  candidates: KnowledgeSearchCandidate[],
) {
  const blockIds = Array.from(
    new Set(candidates.map((candidate) => candidate.blockId).filter((id): id is string => Boolean(id))),
  );

  if (blockIds.length === 0) return [];

  return prisma.documentBlock.findMany({
    where: { id: { in: blockIds } },
    select: {
      id: true,
      documentId: true,
      parentBlockId: true,
      blockIndex: true,
      type: true,
      title: true,
      normalizedContent: true,
      sectionPath: true,
      pageStart: true,
      pageEnd: true,
      topicLinks: {
        where: { status: 'CLASSIFIED', topicId: { not: null } },
        select: {
          topicId: true,
          confidence: true,
          isPrimary: true,
          topic: { select: { name: true } },
        },
      },
      parent: {
        select: {
          id: true,
          title: true,
          type: true,
          normalizedContent: true,
          sectionPath: true,
          pageStart: true,
          pageEnd: true,
        },
      },
    },
  });
}
