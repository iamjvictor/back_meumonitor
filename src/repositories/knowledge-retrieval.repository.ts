import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type KnowledgeSearchInput = {
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId?: string;
  documentId?: string;
  queryText?: string;
  queryEmbedding: number[];
  limit?: number;
  sectionPath?: string[];
  blockTypes?: string[];
  excludeChunkIds?: string[];
  excludedBlockIds?: string[];
  supportOnly?: boolean;
  questionDocumentId?: string;
  questionBlockId?: string;
  questionNumber?: string;
};

export type KnowledgeSearchCandidate = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  parentBlockId: string | null;
  chunkIndex: number;
  blockType: string;
  similarity: number;
  lexicalScore: number;
  fusedScore: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: unknown;
  isComplete: boolean;
  incompleteReason: string | null;
  reason: string | null;
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
  const documentFilter = input.documentId
    ? Prisma.sql`AND dc.document_id = ${input.documentId}::uuid`
    : Prisma.empty;
  const sectionFilter = input.sectionPath?.length
    ? Prisma.sql`AND db.section_path @> ${JSON.stringify(input.sectionPath)}::jsonb`
    : Prisma.empty;
  const blockTypeFilter = input.blockTypes?.length
    ? Prisma.sql`AND db.type IN (${Prisma.join(input.blockTypes.map((type) => Prisma.sql`${type}`))})`
    : Prisma.empty;
  const queryText = input.queryText?.trim() ?? '';
  const lexicalScore = queryText
    ? Prisma.sql`ts_rank_cd(
        to_tsvector('portuguese', coalesce(dc.embedding_content, dc.content)),
        websearch_to_tsquery('portuguese', ${queryText})
      )`
    : Prisma.sql`0`;
  const similarity = Prisma.sql`1 - (
    dc.embedding::extensions.halfvec(2048)
    <=> ${JSON.stringify(input.queryEmbedding)}::extensions.halfvec(2048)
  )`;

  return prisma.$queryRaw<KnowledgeSearchCandidate[]>(Prisma.sql`
    SELECT
      dc.id AS "chunkId",
      dc.document_id AS "documentId",
      dc.block_id AS "blockId",
      db.parent_block_id AS "parentBlockId",
      dc.chunk_index AS "chunkIndex",
      db.type AS "blockType",
      ${similarity} AS similarity,
      ${lexicalScore} AS "lexicalScore",
      (
        (0.6 * ${similarity})
        + (0.4 * ${lexicalScore})
      ) AS "fusedScore",
      dc.content,
      dc.page_start AS "pageStart",
      dc.page_end AS "pageEnd",
      db.section_path AS "sectionPath",
      COALESCE(dc.status = 'READY'::"ChunkStatus" AND db.is_complete = true, dc.status = 'READY'::"ChunkStatus") AS "isComplete",
      db.incomplete_reason AS "incompleteReason",
      NULL::text AS reason
    FROM document_chunks dc
    LEFT JOIN document_blocks db ON db.id = dc.block_id
    WHERE dc.teacher_id = ${input.teacherId}::uuid
      AND dc.monitor_id = ${input.monitorId}::uuid
      AND dc.subject_id = ${input.subjectId}::uuid
      AND dc.status = 'READY'::"ChunkStatus"
      AND dc.embedding IS NOT NULL
      ${documentFilter}
      ${sectionFilter}
      ${blockTypeFilter}
      ${topicFilter}
    ORDER BY
      (
        (0.6 * ${similarity})
        + (0.4 * ${lexicalScore})
      ) DESC,
      ${similarity} DESC,
      dc.chunk_index ASC
    LIMIT ${limit}
  `);
}

export async function loadKnowledgeContext(
  candidates: Array<{ blockId: string | null }>,
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
