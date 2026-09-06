import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { acquireDocumentAdvisoryLocks } from './document-advisory-lock.js';
import { prisma } from '../lib/prisma.js';

const DOCUMENT_PAGE_INSERT_BATCH_SIZE = 25;
const DOCUMENT_TEXT_TRANSACTION_TIMEOUT_MS = 15_000;

export function assertChunkReplacementSafe(hasExistingFlashcardSource: boolean) {
  if (hasExistingFlashcardSource) {
    throw new Error('Substituicao de chunks abortada: o documento possui FlashcardSource vinculada; chunks, sources e cards foram preservados.');
  }
}

export async function findDocumentForProcessing(documentId: string) {
  console.log('Buscando documento no banco para o worker', {
    event: 'monitor.document_repository_lookup_started',
    documentId,
  });

  const document = await prisma.monitorDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      storagePath: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      tag: true,
      monitorId: true,
      subjectId: true,
      topicId: true,
      topicLinks: { select: { topicId: true } },
    },
  });

  console.log('Busca do documento concluida', {
    event: 'monitor.document_repository_lookup_completed',
    documentId,
    found: Boolean(document),
    topicLinkCount: document?.topicLinks.length || 0,
  });

  return document;
}

export async function saveDocumentTextExtraction(input: {
  documentId: string;
  extractionVersion: string;
  rawContent: string;
  normalizedContent?: string | null;
  pageCount?: number | null;
  quality: 'GOOD' | 'PARTIAL' | 'NEEDS_OCR' | 'FAILED';
  qualityDetails: Prisma.InputJsonValue;
  pages: Array<{
    pageNumber: number;
    rawContent: string;
    normalizedContent?: string | null;
    hasImages?: boolean | null;
    charStart?: number | null;
    charEnd?: number | null;
  }>;
}) {
  console.log('Salvando versao da extracao de texto', {
    event: 'monitor.document_text_persistence_started',
    documentId: input.documentId,
    extractionVersion: input.extractionVersion,
    pageCount: input.pageCount,
    quality: input.quality,
    textChars: input.rawContent.length,
    transactionTimeoutMs: DOCUMENT_TEXT_TRANSACTION_TIMEOUT_MS,
  });

  const extraction = await prisma.$transaction(async (transaction) => {
    await transaction.documentText.deleteMany({
      where: {
        documentId: input.documentId,
        extractionVersion: input.extractionVersion,
      },
    });

    return transaction.documentText.create({
      data: {
        documentId: input.documentId,
        extractionVersion: input.extractionVersion,
        rawContent: input.rawContent,
        normalizedContent: input.normalizedContent ?? null,
        pageCount: input.pageCount ?? null,
        quality: input.quality,
        qualityDetails: input.qualityDetails,
      },
      select: {
        id: true,
        documentId: true,
        extractionVersion: true,
        pageCount: true,
        quality: true,
      },
    });
  }, {
    maxWait: 10_000,
    timeout: DOCUMENT_TEXT_TRANSACTION_TIMEOUT_MS,
  });

  try {
    for (let offset = 0; offset < input.pages.length; offset += DOCUMENT_PAGE_INSERT_BATCH_SIZE) {
      const pageBatch = input.pages.slice(offset, offset + DOCUMENT_PAGE_INSERT_BATCH_SIZE);
      const batchNumber = Math.floor(offset / DOCUMENT_PAGE_INSERT_BATCH_SIZE) + 1;
      const batchCount = Math.ceil(input.pages.length / DOCUMENT_PAGE_INSERT_BATCH_SIZE);

      console.log('Salvando lote de paginas da extracao', {
        event: 'monitor.document_text_pages_batch_started',
        documentId: input.documentId,
        documentTextId: extraction.id,
        batchNumber,
        batchCount,
        pageStart: pageBatch[0]?.pageNumber ?? null,
        pageEnd: pageBatch.at(-1)?.pageNumber ?? null,
        pageCount: pageBatch.length,
      });

      await prisma.$transaction((transaction) => transaction.documentPage.createMany({
        data: pageBatch.map((page) => ({
          ...page,
          documentTextId: extraction.id,
        })),
      }), { maxWait: 10_000, timeout: 15_000 });

      console.log('Lote de paginas da extracao salvo', {
        event: 'monitor.document_text_pages_batch_completed',
        documentId: input.documentId,
        documentTextId: extraction.id,
        batchNumber,
        batchCount,
        pageCount: pageBatch.length,
      });
    }
  } catch (error) {
    await prisma.documentText.delete({ where: { id: extraction.id } }).catch(() => undefined);
    throw error;
  }

  console.log('Versao da extracao de texto salva', {
    event: 'monitor.document_text_persistence_completed',
    documentId: input.documentId,
    documentTextId: extraction.id,
    extractionVersion: extraction.extractionVersion,
    pageCount: extraction.pageCount,
    quality: extraction.quality,
  });

  return extraction;
}

export type DocumentChunkInput = {
  blockId: string;
  chunkIndexInBlock: number;
  content: string;
  embeddingContent: string | null;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  status: 'EMBEDDING_PENDING' | 'READY';
};

export async function findDocumentBlocksForChunking(documentId: string, documentTextId: string) {
  console.log('Buscando blocos estruturais para chunking', {
    event: 'monitor.document_blocks_for_chunking_lookup_started',
    documentId,
    documentTextId,
  });

  const document = await prisma.monitorDocument.findUnique({
    where: { id: documentId },
    select: {
      originalName: true,
      subject: { select: { name: true } },
      topicLinks: { select: { topic: { select: { name: true } } } },
    },
  });

  const blocks = await prisma.documentBlock.findMany({
    where: { documentId, documentTextId, status: { not: 'FAILED' } },
    select: {
      id: true,
      blockIndex: true,
      type: true,
      title: true,
      normalizedContent: true,
      isComplete: true,
      incompleteReason: true,
      sectionPath: true,
      questionNumber: true,
      institution: true,
      examYear: true,
      pageStart: true,
      pageEnd: true,
      topicLinks: {
        where: { status: 'CLASSIFIED', topicId: { not: null } },
        select: {
          topic: { select: { id: true, name: true } },
          confidence: true,
          isPrimary: true,
        },
      },
    },
    orderBy: { blockIndex: 'asc' },
  });

  console.log('Blocos estruturais carregados para chunking', {
    event: 'monitor.document_blocks_for_chunking_lookup_completed',
    documentId,
    documentTextId,
    blockCount: blocks.length,
    blockTypes: blocks.reduce<Record<string, number>>((counts, block) => {
      counts[block.type] = (counts[block.type] || 0) + 1;
      return counts;
    }, {}),
  });

  return {
    blocks,
    context: {
      documentTitle: document?.originalName ?? null,
      subjectName: document?.subject.name ?? null,
      topicNames: document?.topicLinks.map((link) => link.topic.name) ?? [],
    },
  };
}

export async function saveExtractedChunks(documentId: string, chunks: DocumentChunkInput[]) {
  console.log('Preparando chunks para persistencia', {
    event: 'monitor.document_chunks_prepare_started',
    documentId,
    chunkCount: chunks.length,
  });

  const document = await prisma.monitorDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      teacherId: true,
      monitorId: true,
      subjectId: true,
      topicLinks: { select: { topicId: true } },
    },
  });

  if (!document) throw new Error('Documento nao encontrado para salvar chunks.');

  const blockIds = Array.from(new Set(chunks.map((chunk) => chunk.blockId)));
  const blocks = await prisma.documentBlock.findMany({
    where: { id: { in: blockIds }, documentId },
    select: {
      id: true,
      topicLinks: {
        where: { status: 'CLASSIFIED', topicId: { not: null } },
        select: { topicId: true },
      },
    },
  });
  if (blocks.length !== blockIds.length) {
    throw new Error('Um ou mais blocos dos chunks nao pertencem ao documento.');
  }

  const documentTopicIds = Array.from(new Set(
    document.topicLinks
      .map((topic) => topic.topicId)
      .filter((topicId): topicId is string => topicId !== null),
  ));

  const chunkRows = chunks.map((chunk, chunkIndex) => ({
    id: randomUUID(),
    documentId: document.id,
    teacherId: document.teacherId,
    monitorId: document.monitorId,
    subjectId: document.subjectId,
    chunkIndex,
    blockId: chunk.blockId,
    chunkIndexInBlock: chunk.chunkIndexInBlock,
    content: chunk.content,
    embeddingContent: chunk.embeddingContent,
    contentHash: createHash('sha256').update(chunk.content).digest('hex'),
    charCount: chunk.content.length,
    tokenCount: chunk.tokenCount,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    status: chunk.status,
  }));
  const topicIdsByBlockId = new Map(
    blocks.map((block) => {
      const blockTopicIds = Array.from(new Set(
        block.topicLinks
          .map((topic) => topic.topicId)
          .filter((topicId): topicId is string => topicId !== null),
      ));
      return [block.id, blockTopicIds.length > 0 ? blockTopicIds : documentTopicIds] as const;
    }),
  );
  const chunkTopicRows = chunkRows.flatMap((chunk) =>
    (topicIdsByBlockId.get(chunk.blockId) ?? []).map((topicId) => ({
      chunkId: chunk.id,
      topicId,
    })),
  );
  const topicCount = new Set(chunkTopicRows.map((topic) => topic.topicId)).size;
  const topicLinkCount = chunkTopicRows.length;

  console.log('Iniciando transacao dos chunks', {
    event: 'monitor.document_chunks_transaction_started',
      documentId,
      replacingExistingChunks: true,
      chunkCount: chunkRows.length,
      blockCount: blockIds.length,
  });

  await prisma.$transaction(async (transaction) => {
    // Serialize replacement per document, then re-check the source immediately
    // before the destructive operation. The check outside this transaction is
    // intentionally not trusted for concurrency safety.
    await acquireDocumentAdvisoryLocks(transaction, [documentId]);
    const existingSource = await transaction.flashcardSource.findFirst({
      where: { chunk: { documentId } },
      select: { chunkId: true },
    });
    assertChunkReplacementSafe(Boolean(existingSource));
    await transaction.documentChunk.deleteMany({ where: { documentId } });

    if (chunkRows.length > 0) {
      await transaction.documentChunk.createMany({ data: chunkRows });
      await transaction.documentChunkTopic.createMany({
        data: chunkTopicRows,
        skipDuplicates: true,
      });
    }
  });

  console.log('Transacao dos chunks concluida', {
    event: 'monitor.document_chunks_transaction_completed',
    documentId,
    chunkCount: chunkRows.length,
    blockCount: blockIds.length,
    topicLinkCount,
    status: 'EMBEDDING_PENDING',
  });

  return {
    chunkCount: chunkRows.length,
    topicCount,
    topicLinkCount,
  };
}

export async function markDocumentProcessing(documentId: string) {
  console.log('Atualizando documento para PROCESSING', {
    event: 'monitor.document_status_update_started',
    documentId,
    status: 'PROCESSING',
  });

  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { status: 'PROCESSING', errorMessage: null },
  });

  console.log('Documento atualizado para PROCESSING', {
    event: 'monitor.document_status_update_completed',
    documentId,
    status: 'PROCESSING',
  });
}

export async function markDocumentNeedsOcr(documentId: string) {
  console.log('Atualizando documento para NEEDS_OCR', {
    event: 'monitor.document_status_update_started',
    documentId,
    status: 'NEEDS_OCR',
  });

  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { status: 'NEEDS_OCR', errorMessage: null },
  });

  console.log('Documento atualizado para NEEDS_OCR', {
    event: 'monitor.document_status_update_completed',
    documentId,
    status: 'NEEDS_OCR',
  });
}

export async function markDocumentReady(documentId: string) {
  console.log('Atualizando documento para READY', {
    event: 'monitor.document_status_update_started',
    documentId,
    status: 'READY',
  });

  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { status: 'READY', errorMessage: null },
  });

  console.log('Documento atualizado para READY', {
    event: 'monitor.document_status_update_completed',
    documentId,
    status: 'READY',
  });
}

export async function markDocumentPartialSuccess(documentId: string, errorMessage: string) {
  console.log('Atualizando documento para PARTIAL_SUCCESS', {
    event: 'monitor.document_status_update_started',
    documentId,
    status: 'PARTIAL_SUCCESS',
    errorMessage: errorMessage.slice(0, 300),
  });

  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { status: 'PARTIAL_SUCCESS', errorMessage: errorMessage.slice(0, 1000) },
  });

  console.log('Documento atualizado para PARTIAL_SUCCESS', {
    event: 'monitor.document_status_update_completed',
    documentId,
    status: 'PARTIAL_SUCCESS',
  });
}

export async function markDocumentFailed(documentId: string, errorMessage: string) {
  console.log('Atualizando documento para FAILED', {
    event: 'monitor.document_status_update_started',
    documentId,
    status: 'FAILED',
    errorMessage: errorMessage.slice(0, 300),
  });

  await prisma.monitorDocument.update({
    where: { id: documentId },
    data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 1000) },
  });

  console.log('Documento atualizado para FAILED', {
    event: 'monitor.document_status_update_completed',
    documentId,
    status: 'FAILED',
  });
}

export async function findPendingChunksForEmbedding(documentId: string) {
  console.log('Buscando chunks pendentes de embedding', {
    event: 'monitor.embedding_chunks_lookup_started',
    documentId,
    status: 'EMBEDDING_PENDING',
  });

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId, status: 'EMBEDDING_PENDING' },
    select: {
      id: true,
      chunkIndex: true,
      content: true,
      embeddingContent: true,
      blockId: true,
      tokenCount: true,
    },
    orderBy: { chunkIndex: 'asc' },
  });

  console.log('Chunks pendentes encontrados', {
    event: 'monitor.embedding_chunks_lookup_completed',
    documentId,
    chunkCount: chunks.length,
    chunkIndexes: chunks.map((chunk) => chunk.chunkIndex),
  });

  return chunks;
}

export async function findChunkForFlashcardGeneration(chunkId: string) {
  return prisma.documentChunk.findUnique({
    where: { id: chunkId },
    select: {
      id: true,
      content: true,
      status: true,
      block: { select: { type: true } },
      document: {
        select: {
          teacherId: true,
          monitorId: true,
          subjectId: true,
        },
      },
      topicLinks: { select: { topicId: true } },
    },
  });
}

export async function findFlashcardGenerationChunkIds(documentId: string) {
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId, status: 'READY', block: { type: { in: ['THEORY', 'DEFINITION', 'FORMULA', 'EXAMPLE'] } } },
    select: { id: true }, orderBy: { chunkIndex: 'asc' },
  });
  return chunks.map((chunk) => chunk.id);
}

export async function markChunksEmbeddingProcessing(chunkIds: string[]) {
  if (chunkIds.length === 0) return;

  console.log('Atualizando chunks para EMBEDDING_PROCESSING', {
    event: 'monitor.embedding_chunks_status_started',
    chunkCount: chunkIds.length,
  });

  await prisma.documentChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: { status: 'EMBEDDING_PROCESSING' },
  });

  console.log('Chunks atualizados para EMBEDDING_PROCESSING', {
    event: 'monitor.embedding_chunks_status_completed',
    chunkCount: chunkIds.length,
    status: 'EMBEDDING_PROCESSING',
  });
}

export async function saveChunkEmbeddings(
  rows: Array<{
    id: string;
    embedding: number[];
    embeddingModel: string;
    embeddingVersion: string;
  }>,
) {
  const transactionTimeoutMs = 60_000;

  console.log('Persistindo vetores dos chunks', {
    event: 'monitor.embedding_vectors_persist_started',
    chunkCount: rows.length,
    dimensions: rows[0]?.embedding.length || 0,
    transactionTimeoutMs,
  });

  await prisma.$transaction(
    rows.map(({ id, embedding, embeddingModel, embeddingVersion }) => prisma.$executeRaw`
      UPDATE document_chunks
      SET embedding = ${JSON.stringify(embedding)}::extensions.vector,
          embedding_model = ${embeddingModel},
          embedding_version = ${embeddingVersion},
          embedded_at = NOW(),
          status = 'READY'::"ChunkStatus",
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `),
    {
      maxWait: 10_000,
      timeout: transactionTimeoutMs,
    },
  );

  console.log('Vetores dos chunks persistidos', {
    event: 'monitor.embedding_vectors_persist_completed',
    chunkCount: rows.length,
    status: 'READY',
  });
}

export async function markChunksEmbeddingFailed(chunkIds: string[]) {
  if (chunkIds.length === 0) return;

  console.log('Atualizando chunks para FAILED', {
    event: 'monitor.embedding_chunks_failure_started',
    chunkCount: chunkIds.length,
  });

  await prisma.documentChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: { status: 'FAILED' },
  });

  console.log('Chunks atualizados para FAILED', {
    event: 'monitor.embedding_chunks_failure_completed',
    chunkCount: chunkIds.length,
    status: 'FAILED',
  });
}

export async function markChunksEmbeddingPending(chunkIds: string[]) {
  if (chunkIds.length === 0) return;

  await prisma.documentChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: { status: 'EMBEDDING_PENDING' },
  });
}

export async function findQuestionAnalysisScope(documentId: string) {
  return prisma.monitorDocument.findUnique({
    where: { id: documentId },
    select: { id: true, monitorId: true, subjectId: true },
  });
}

export async function findSimilarChunksForQuestionAnalysis(
  scope: { monitorId: string; subjectId: string },
  queryEmbedding: number[],
  limit = 16,
) {
  return prisma.$queryRaw<Array<{
    id: string;
    documentId: string;
    chunkIndex: number;
    content: string;
    similarity: number;
  }>>`
    SELECT
      dc.id,
      dc.document_id AS "documentId",
      dc.chunk_index AS "chunkIndex",
      dc.content,
      1 - (
        dc.embedding::extensions.halfvec(2048)
        <=> ${JSON.stringify(queryEmbedding)}::extensions.halfvec(2048)
      ) AS similarity
    FROM document_chunks dc
    WHERE dc.monitor_id = ${scope.monitorId}::uuid
      AND dc.subject_id = ${scope.subjectId}::uuid
      AND dc.status = 'READY'::"ChunkStatus"
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding::extensions.halfvec(2048)
      <=> ${JSON.stringify(queryEmbedding)}::extensions.halfvec(2048)
    LIMIT ${limit}
  `;
}
