import { OpenRouterClient } from '../client/openrouter.client.js';
import { env } from '../../config/env.js';
import { aiModels } from '../../config/ai-models.config.js';
import {
  findPendingChunksForEmbedding,
  markChunksEmbeddingPending,
  markChunksEmbeddingProcessing,
  saveChunkEmbeddings,
} from '../../repositories/document-worker.repository.js';
import { DOCUMENT_EMBEDDING_VERSION } from './chunk.service.js';

const EMBEDDING_MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  return /\b429\b|too many requests|rate limit/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class EmbeddingService {
  constructor(private readonly client = new OpenRouterClient()) {}

  async processDocument(documentId: string) {
    const startedAt = Date.now();
    const chunks = await findPendingChunksForEmbedding(documentId);

    console.log('Processamento de embeddings iniciado', {
      event: 'monitor.document_embeddings_started',
      documentId,
      chunkCount: chunks.length,
      batchSize: aiModels.embeddingBatchSize,
    });

    if (chunks.length === 0) {
      console.log('Nenhum chunk pendente para vetorizar', {
        event: 'monitor.document_embeddings_skipped',
        documentId,
      });
      return { chunkCount: 0, batchCount: 0 };
    }

    const persistedChunkIds = new Set<string>();

    try {
      await markChunksEmbeddingProcessing(chunks.map((chunk) => chunk.id));
      console.log('Chunks reservados para processamento de embeddings', {
        event: 'monitor.document_embeddings_chunks_reserved',
        documentId,
        chunkCount: chunks.length,
      });
      let processedCount = 0;
      let batchCount = 0;
      for (let start = 0; start < chunks.length; start += aiModels.embeddingBatchSize) {
        const batch = chunks.slice(start, start + aiModels.embeddingBatchSize);
        batchCount += 1;

        console.log('Enviando lote de chunks para embeddings', {
          event: 'monitor.document_embeddings_batch_started',
          documentId,
          batchNumber: batchCount,
          batchCount: batch.length,
          firstChunkIndex: batch[0]?.chunkIndex,
          blockIds: Array.from(new Set(batch.map((chunk) => chunk.blockId).filter(Boolean))),
        });

        let embeddings: number[][] | null = null;
        for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt += 1) {
          try {
            embeddings = await this.client.createEmbeddings(
              batch.map((chunk) => chunk.embeddingContent || chunk.content),
            );
            break;
          } catch (error) {
            if (!isRateLimitError(error) || attempt === EMBEDDING_MAX_RETRIES) throw error;
            const delayMs = Math.min(20_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
            console.log('Rate limit de embeddings; aguardando para tentar novamente', {
              event: 'monitor.document_embeddings_rate_limited',
              documentId,
              batchNumber: batchCount,
              attempt,
              nextAttempt: attempt + 1,
              delayMs,
            });
            await sleep(delayMs);
          }
        }
        if (!embeddings) throw new Error('Embeddings nao foram retornados pelo provider.');
        console.log('Embeddings do lote recebidos, iniciando persistencia', {
          event: 'monitor.document_embeddings_batch_response_ready',
          documentId,
          batchNumber: batchCount,
          embeddingCount: embeddings.length,
          dimensions: embeddings[0]?.length || 0,
        });
        await saveChunkEmbeddings(batch.map((chunk, index) => ({
          id: chunk.id,
          embedding: embeddings[index]!,
          embeddingModel: env.OPENROUTER_EMBEDDING_MODEL,
          embeddingVersion: DOCUMENT_EMBEDDING_VERSION,
        })));
        batch.forEach((chunk) => persistedChunkIds.add(chunk.id));
        processedCount += batch.length;

        console.log('Lote de embeddings persistido', {
          event: 'monitor.document_embeddings_batch_completed',
          documentId,
          batchNumber: batchCount,
          processedCount,
          totalChunks: chunks.length,
        });
      }

      console.log('Processamento de embeddings concluido', {
        event: 'monitor.document_embeddings_completed',
        documentId,
        chunkCount: processedCount,
        batchCount,
        durationMs: Date.now() - startedAt,
      });

      return { chunkCount: processedCount, batchCount };
    } catch (error) {
      try {
        const failedChunkIds = chunks
          .filter((chunk) => !persistedChunkIds.has(chunk.id))
          .map((chunk) => chunk.id);

        // Keep failed vectors retryable and allow question extraction to use
        // the chunk text even when the provider is unavailable.
        await markChunksEmbeddingPending(failedChunkIds);
      } catch (statusError) {
        console.log('Falha adicional ao devolver chunks para EMBEDDING_PENDING', {
          event: 'monitor.document_embeddings_failure_status_failed',
          documentId,
          statusError,
        });
      }
      console.log('Falha no processamento de embeddings', {
        event: 'monitor.document_embeddings_failed',
        documentId,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }
}
