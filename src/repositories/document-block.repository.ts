import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type DocumentBlockInput = {
  documentId: string;
  documentTextId: string;
  parentBlockId?: string | null;
  blockIndex: number;
  type: 'TITLE' | 'SECTION' | 'SUBSECTION' | 'THEORY' | 'DEFINITION' | 'FORMULA' | 'EXAMPLE' | 'QUESTION' | 'ANSWER_KEY' | 'SOLUTION' | 'TABLE' | 'LIST' | 'IMAGE_REFERENCE' | 'UNKNOWN';
  title?: string | null;
  rawContent: string;
  normalizedContent: string;
  sectionPath: Prisma.InputJsonValue;
  questionNumber?: string | null;
  institution?: string | null;
  examYear?: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  charStart: number;
  charEnd: number;
  detectionMethod: 'REGEX' | 'HEURISTIC' | 'LLM' | 'MANUAL';
  confidence?: number | null;
  isComplete?: boolean;
  incompleteReason?: string | null;
  status: 'READY' | 'NEEDS_REVIEW' | 'FAILED';
};

export async function replaceDocumentBlocks(documentTextId: string, blocks: DocumentBlockInput[]) {
  const batchSize = 25;
  const transactionTimeoutMs = 15_000;

  console.log('Persistindo blocos estruturais do documento', {
    event: 'monitor.document_blocks_persistence_started',
    documentTextId,
    blockCount: blocks.length,
    batchSize,
    transactionTimeoutMs,
  });

  await prisma.$transaction(
    (transaction) => transaction.documentBlock.deleteMany({ where: { documentTextId } }),
    { maxWait: 10_000, timeout: transactionTimeoutMs },
  );

  const ids: string[] = [];
  try {
    for (let offset = 0; offset < blocks.length; offset += batchSize) {
      const batch = blocks.slice(offset, offset + batchSize);
      const batchNumber = Math.floor(offset / batchSize) + 1;
      const batchCount = Math.ceil(blocks.length / batchSize);

      console.log('Persistindo lote de blocos estruturais', {
        event: 'monitor.document_blocks_persistence_batch_started',
        documentTextId,
        batchNumber,
        batchCount,
        blockStart: batch[0]?.blockIndex ?? null,
        blockEnd: batch.at(-1)?.blockIndex ?? null,
        blockCount: batch.length,
      });

      await prisma.$transaction(async (transaction) => {
        for (const block of batch) {
          const parentBlockId = block.parentBlockId
            ? ids[Number(block.parentBlockId)] ?? null
            : null;

          const row = await transaction.documentBlock.create({
            data: {
              documentId: block.documentId,
              documentTextId: block.documentTextId,
              parentBlockId,
              blockIndex: block.blockIndex,
              type: block.type,
              title: block.title ?? null,
              rawContent: block.rawContent,
              normalizedContent: block.normalizedContent,
              sectionPath: block.sectionPath,
              questionNumber: block.questionNumber ?? null,
              institution: block.institution ?? null,
              examYear: block.examYear ?? null,
              pageStart: block.pageStart ?? null,
              pageEnd: block.pageEnd ?? null,
              charStart: block.charStart,
              charEnd: block.charEnd,
              contentHash: createHash('sha256').update(block.normalizedContent).digest('hex'),
              detectionMethod: block.detectionMethod,
              confidence: block.confidence ?? null,
              isComplete: block.isComplete ?? true,
              incompleteReason: block.incompleteReason ?? null,
              status: block.status,
            },
            select: { id: true, blockIndex: true },
          });

          ids[block.blockIndex] = row.id;
        }
      }, { maxWait: 10_000, timeout: transactionTimeoutMs });

      console.log('Lote de blocos estruturais persistido', {
        event: 'monitor.document_blocks_persistence_batch_completed',
        documentTextId,
        batchNumber,
        batchCount,
        blockCount: batch.length,
      });
    }
  } catch (error) {
    await prisma.documentBlock.deleteMany({ where: { documentTextId } }).catch(() => undefined);
    throw error;
  }

  const created = ids.length;

  console.log('Blocos estruturais persistidos', {
    event: 'monitor.document_blocks_persistence_completed',
    documentTextId,
    blockCount: created,
  });

  return { blockCount: created };
}
