import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { aiModels } from '../../config/ai-models.config.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import {
  findDocumentForProcessing,
  markDocumentProcessing,
  markDocumentPartialSuccess,
  markDocumentReady,
  markDocumentFailed,
  markDocumentNeedsOcr,
} from '../../repositories/document-worker.repository.js';
import { ChunkService } from './chunk.service.js';
import { DocumentBlockDetectionService } from './document-block-detection.service.js';
import { DOCUMENT_PROCESSING_VERSION } from '../../repositories/document-processing-job.repository.js';
import { DocumentTextExtractionService } from './document-text-extraction.service.js';
import { EmbeddingService } from './embedding.service.js';
import { FlashcardGenerationService } from './flashcard/flashcard-generation.service.js';
import { QuestionExtractionService } from './question-extraction.service.js';
import { TopicProfileGenerationService } from './topic-profile-generation.service.js';
import { extractPdfPagesWithLayout } from './pdf-layout-extraction.service.js';
import { appendProcessingTimeReport, formatDuration } from './processing-time-report.service.js';
import {
  createDocumentIngestionV3Service,
  type DocumentIngestionV3Service,
} from './document-parser/document-ingestion-v3.service.js';
import {
  completeDocumentProcessingJob,
  ensureDocumentProcessingJobs,
  failDocumentProcessingJob,
  skipDocumentProcessingJob,
  startDocumentProcessingJob,
  type DocumentProcessingOperation,
} from '../../repositories/document-processing-job.repository.js';

const BUCKET = 'monitor-documents';

function sanitizeCountMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (/^[A-Z0-9_]+$/.test(key) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
      result[key] = count;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function sanitizeFlashcardOutputSummary(result: unknown): Record<string, Prisma.InputJsonValue> {
  const outputSummary: Record<string, Prisma.InputJsonValue> = {
    durationMs: 0,
    status: 'READY',
  };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return outputSummary;
  const source = result as Record<string, unknown>;
  const summaryKeys = [
    'chunkCount', 'batchCount', 'blockCount', 'typeCounts', 'reviewCount',
    'savedCount', 'duplicateCount', 'questionCount', 'detectedCount',
    'incompleteCount', 'sourceBlockCount', 'candidateCount',
    'generated', 'accepted', 'persisted', 'rejected', 'duplicates', 'failedChunks',
    'attemptedChunks', 'successfulChunks',
  ] as const;
  for (const key of summaryKeys) {
    const value = source[key];
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') outputSummary[key] = value;
    else if (value && typeof value === 'object' && key === 'typeCounts') outputSummary[key] = value as Prisma.InputJsonValue;
  }
  if (Array.isArray(source.failedChunksDetail)) {
    outputSummary.failedChunksDetail = source.failedChunksDetail.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const detail = item as Record<string, unknown>;
      return typeof detail.chunkId === 'string' && typeof detail.code === 'string'
        ? [{ chunkId: detail.chunkId, code: detail.code }]
        : [];
    });
  }
  const ineligibleReasons = sanitizeCountMap(source.ineligibleReasons);
  if (ineligibleReasons) outputSummary.ineligibleReasons = ineligibleReasons;
  const rejectedReasons = sanitizeCountMap(source.rejectedReasons);
  if (rejectedReasons) outputSummary.rejectedReasons = rejectedReasons;
  return outputSummary;
}

export function resolveTrackedOperationStatus(result: unknown) {
  const status = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>).status
    : undefined;
  return status === 'FAILED' || status === 'PARTIAL_SUCCESS' ? status : 'READY';
}

export function shouldProcessDocumentContent(
  tag: 'KNOWLEDGE_BASE' | 'QUESTIONS' | 'FLASHCARDS',
) {
  return tag === 'KNOWLEDGE_BASE' || tag === 'QUESTIONS' || tag === 'FLASHCARDS';
}

export function resolveDocumentStatus(
  failures: Array<{ operation: DocumentProcessingOperation; error: unknown }>,
) {
  return failures.length > 0
    ? 'PARTIAL_SUCCESS' as const
    : 'READY' as const;
}

export function shouldGenerateFlashcardsAfterEmbeddings(
  tag: 'KNOWLEDGE_BASE' | 'QUESTIONS' | 'FLASHCARDS',
  embeddingsSucceeded: boolean,
  readyChunkCount: number,
) {
  return tag === 'FLASHCARDS' && embeddingsSucceeded && readyChunkCount > 0;
}

export type DocumentWorkerContext = {
  jobId?: string;
  attempt?: number;
};

export type DocumentWorkerServiceDependencies = {
  documentIngestionV3Service?: DocumentIngestionV3Service | null;
  flashcardGenerationService?: Pick<FlashcardGenerationService, 'processDocument'>;
  flashcardConcurrency?: number;
};

export class DocumentWorkerService {
  private readonly documentIngestionV3Service: DocumentIngestionV3Service | null;
  private readonly flashcardGenerationService: Pick<FlashcardGenerationService, 'processDocument'>;
  private readonly flashcardConcurrency: number;

  constructor(
    private readonly chunkService = new ChunkService(),
    private readonly documentTextExtractionService = new DocumentTextExtractionService(),
    private readonly documentBlockDetectionService = new DocumentBlockDetectionService(),
    private readonly embeddingService = new EmbeddingService(),
    private readonly questionExtractionService = new QuestionExtractionService(),
    private readonly topicProfileGenerationService = new TopicProfileGenerationService(),
    dependencies: DocumentWorkerServiceDependencies = {},
  ) {
    if (env.DOCUMENT_INGESTION_V3_ENABLED && !env.DOCUMENT_PARSER_BASE_URL && !dependencies.documentIngestionV3Service) {
      console.log('Shadow parser V3 desativado: DOCUMENT_PARSER_BASE_URL nao foi configurado', {
        event: 'monitor.document_ingestion_v3_missing_base_url',
      });
    }
    this.documentIngestionV3Service = dependencies.documentIngestionV3Service
      ?? (env.DOCUMENT_INGESTION_V3_ENABLED && env.DOCUMENT_PARSER_BASE_URL
        ? createDocumentIngestionV3Service({ parserBaseUrl: env.DOCUMENT_PARSER_BASE_URL })
        : null);
    this.flashcardGenerationService = dependencies.flashcardGenerationService ?? new FlashcardGenerationService();
    this.flashcardConcurrency = dependencies.flashcardConcurrency ?? aiModels.flashcardGenerationConcurrency;
  }

  async process(documentId: string, context: DocumentWorkerContext = {}) {
    const startedAt = Date.now();
    const nonBlockingFailures: Array<{ operation: DocumentProcessingOperation; error: unknown }> = [];

    console.log('Worker iniciou o processamento do documento', {
      event: 'monitor.document_processing_started',
      documentId,
      jobId: context.jobId,
      attempt: context.attempt,
    });

    let document;
    try {
      document = await findDocumentForProcessing(documentId);
    } catch (error) {
      console.log('Falha ao buscar documento para processamento', {
        event: 'monitor.document_lookup_failed',
        documentId,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }

    if (!document) {
      console.log('Job ignorado: documento nao encontrado', {
        event: 'monitor.document_job_missing',
        documentId,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    await ensureDocumentProcessingJobs(document.id);
    const track = <T>(
      operation: DocumentProcessingOperation,
      action: () => Promise<T>,
      inputSnapshot?: Prisma.InputJsonValue,
    ) => this.runTrackedOperation(document.id, operation, action, inputSnapshot, context);
    try {
      await markDocumentProcessing(document.id);
    } catch (error) {
      console.log('Falha ao marcar documento como PROCESSING', {
        event: 'monitor.document_processing_status_failed',
        documentId: document.id,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }

    try {
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(document.storagePath);
      if (error || !data) throw new Error(error?.message || 'Arquivo nao encontrado no storage.');
      const pdfBytes = new Uint8Array(await data.arrayBuffer());
      const contentHash = createHash('sha256').update(pdfBytes).digest('hex');

      if (this.documentIngestionV3Service && shouldProcessDocumentContent(document.tag)) {
        try {
          console.log('Enviando PDF ao Docling para extracao de layout', {
            event: 'monitor.document_ingestion_v3_started',
            documentId: document.id,
            parser: 'DOCLING',
            sizeBytes: pdfBytes.byteLength,
          });
          const v3Result = await this.documentIngestionV3Service.processDocument({
            documentId: document.id,
            storagePath: document.storagePath,
            originalName: document.originalName,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            contentHash,
            fileBytes: pdfBytes,
            backend: 'pipeline',
            parserVersion: 'docling-v3',
            modelVersion: 'docling-layout-v3',
            configurationHash: `worker:${DOCUMENT_PROCESSING_VERSION}`,
            schemaVersion: 'layout-v1',
          });
          console.log('Shadow parser V3 executado', {
            event: 'monitor.document_ingestion_v3_shadow_completed',
            documentId: document.id,
            parseRunId: v3Result.parseRunId,
            status: v3Result.status,
            layoutPersisted: v3Result.layoutPersisted,
            fallbackReason: v3Result.fallbackReason ?? null,
          });
          if (v3Result.status === 'FALLBACK_REQUIRED') {
            throw new Error(v3Result.fallbackReason ?? 'Docling solicitou fallback.');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await markDocumentFailed(document.id, `Docling falhou; extração legada desativada: ${errorMessage}`);
          console.log('Docling falhou; processamento interrompido sem fallback legado', {
            event: 'monitor.document_ingestion_v3_failed_processing_paused',
            documentId: document.id,
            errorMessage,
            error,
          });
          throw error;
        }
      }

      if (shouldProcessDocumentContent(document.tag)) {
        console.log('Iniciando extracao de texto da base de conhecimento', {
          event: 'monitor.document_text_extraction_started',
          documentId: document.id,
          originalName: document.originalName,
        });

        const parsedPdf = await track(
          'EXTRACT_TEXT',
          async () => {
            const pages = await extractPdfPagesWithLayout(pdfBytes);
            return {
              total: pages.length,
              pages: pages.map((page) => ({
                num: page.num,
                text: page.text,
                hasImages: page.hasImages,
                imageCount: page.imageCount,
              })),
              text: pages.map((page) => page.text).join('\n\n'),
            };
          },
          { mimeType: document.mimeType, sizeBytes: document.sizeBytes },
        );

        console.log('Texto extraido do documento', {
          event: 'monitor.document_text_extraction_completed',
          documentId: document.id,
          textChars: parsedPdf.text.length,
          pageCount: parsedPdf.total,
          parsedPageCount: parsedPdf.pages.length,
        });

        const textExtraction = await track(
          'NORMALIZE_TEXT',
          () => this.documentTextExtractionService.process(document.id, parsedPdf, document.sizeBytes),
          { extractionVersion: 'pdf-layout-v2-column-aware' },
        );

        await completeDocumentProcessingJob(document.id, 'EXTRACT_TEXT', {
          textChars: parsedPdf.text.length,
          pageCount: parsedPdf.total,
        });

        if (textExtraction.quality === 'FAILED') {
          throw new Error('Nao foi possivel extrair texto do PDF.');
        }

        if (textExtraction.quality === 'NEEDS_OCR') {
          await markDocumentNeedsOcr(document.id);
          await this.skipOperations(document.id, [
            'DETECT_BLOCKS',
            'CREATE_RETRIEVAL_CHUNKS',
            'GENERATE_CHUNK_EMBEDDINGS',
            'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
            'MATCH_ANSWER_KEYS',
            'GENERATE_FLASHCARD_CANDIDATES',
            'READY_FOR_REVIEW',
          ], 'document_requires_ocr');
          console.log('Processamento interrompido: documento precisa de OCR', {
            event: 'monitor.document_processing_needs_ocr',
            documentId: document.id,
            documentTextId: textExtraction.documentTextId,
          });
          return;
        }

        const blockResult = await track(
          'DETECT_BLOCKS',
          () => this.documentBlockDetectionService.process(document.id, textExtraction.documentTextId),
          { documentTextId: textExtraction.documentTextId },
        );
        console.log('Blocos estruturais prontos antes do chunking', {
          event: 'monitor.document_blocks_ready_for_chunking',
          documentId: document.id,
          documentTextId: textExtraction.documentTextId,
          blockCount: blockResult.blockCount,
          typeCounts: blockResult.typeCounts,
        });

        await track(
          'CREATE_RETRIEVAL_CHUNKS',
          () => this.chunkService.processDocument(document.id, textExtraction.documentTextId),
          { documentTextId: textExtraction.documentTextId },
        );

        let embeddingResult = { chunkCount: 0, batchCount: 0 };
        let embeddingsSucceeded = false;
        try {
          embeddingResult = await track(
            'GENERATE_CHUNK_EMBEDDINGS',
            () => this.embeddingService.processDocument(document.id),
            { embeddingModel: 'configured-openrouter-model' },
          );
          embeddingsSucceeded = embeddingResult.chunkCount > 0;
          console.log('Chunks da base de conhecimento vetorizados', {
            event: 'monitor.document_embeddings_saved',
            documentId: document.id,
            chunkCount: embeddingResult.chunkCount,
            batchCount: embeddingResult.batchCount,
            embeddingStatus: 'READY',
          });
        } catch (error) {
          nonBlockingFailures.push({ operation: 'GENERATE_CHUNK_EMBEDDINGS', error });
          console.log('Embeddings indisponiveis; processamento textual e questoes continuarao', {
            event: 'monitor.document_embeddings_failed_non_blocking',
            documentId: document.id,
            error,
          });
        }

        if (document.tag === 'KNOWLEDGE_BASE') {
          try {
            if (document.topicId) {
              await this.topicProfileGenerationService.processTopic(document.topicId);
            } else {
              await this.topicProfileGenerationService.processSubject(document.subjectId);
            }
          } catch (error) {
            console.log('Perfil do topico nao foi gerado; processamento continuara', {
              event: 'monitor.topic_profile_generation_failed_non_blocking',
              documentId: document.id,
              topicId: document.topicId,
              subjectId: document.subjectId,
              error,
            });
          }
        }

        if (document.tag === 'KNOWLEDGE_BASE' || document.tag === 'QUESTIONS') {
          try {
            const questionResult = await track(
              'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
              () => this.questionExtractionService.processDocument(document.id),
              { documentTag: document.tag },
            );
            const flashcardResult = await track(
              'MATCH_ANSWER_KEYS',
              async () => undefined,
              { integratedInto: 'EXTRACT_QUESTIONS_TO_PENDING_REVIEW', questionResult: 'completed' },
            );
          } catch (error) {
            nonBlockingFailures.push({ operation: 'EXTRACT_QUESTIONS_TO_PENDING_REVIEW', error });
            await skipDocumentProcessingJob(
              document.id,
              'MATCH_ANSWER_KEYS',
              { reason: 'question_extraction_failed_non_blocking' },
            );
            console.log('Agente de questoes falhou, documento continua pronto', {
              event: 'monitor.question_extraction_failed_non_blocking',
              documentId: document.id,
              error,
            });
          }
        }

        if (document.tag === 'FLASHCARDS') {
          if (shouldGenerateFlashcardsAfterEmbeddings(document.tag, embeddingsSucceeded, embeddingResult.chunkCount)) {
            const flashcardResult = await track(
              'GENERATE_FLASHCARD_CANDIDATES',
              () => this.flashcardGenerationService.processDocument(document.id, this.flashcardConcurrency),
              { documentTag: document.tag, concurrency: this.flashcardConcurrency, embeddingChunkCount: embeddingResult.chunkCount },
            );
            if (flashcardResult.status !== 'READY') nonBlockingFailures.push({ operation: 'GENERATE_FLASHCARD_CANDIDATES', error: new Error(flashcardResult.status) });
          } else {
            await skipDocumentProcessingJob(document.id, 'GENERATE_FLASHCARD_CANDIDATES', {
              reason: 'embeddings_failed_this_execution',
            });
          }
        } else {
          await skipDocumentProcessingJob(document.id, 'GENERATE_FLASHCARD_CANDIDATES', {
            reason: 'automatic_flashcard_generation_disabled',
          });
        }

        if (document.tag === 'FLASHCARDS') {
          await this.skipOperations(document.id, [
            'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
            'MATCH_ANSWER_KEYS',
          ], 'document_tag_flashcards');
        }

      }

      if (!shouldProcessDocumentContent(document.tag)) {
        await this.skipOperations(document.id, [
          'EXTRACT_TEXT',
          'NORMALIZE_TEXT',
          'DETECT_BLOCKS',
          'CREATE_RETRIEVAL_CHUNKS',
          'GENERATE_CHUNK_EMBEDDINGS',
          'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
          'MATCH_ANSWER_KEYS',
          'GENERATE_FLASHCARD_CANDIDATES',
        ], `document_tag_${document.tag.toLowerCase()}_not_supported_yet`);
      }

      const documentStatus = resolveDocumentStatus(nonBlockingFailures);
      if (documentStatus === 'PARTIAL_SUCCESS') {
        const failedOperations = nonBlockingFailures.map(({ operation }) => operation);
        await markDocumentPartialSuccess(
          document.id,
          `Operacoes pendentes: ${failedOperations.join(', ')}`,
        );
      } else {
        await markDocumentReady(document.id);
      }
      await track(
        'READY_FOR_REVIEW',
        async () => undefined,
        { documentStatus },
      );

      console.log('Documento processado pelo worker', {
        event: 'monitor.document_worker_completed',
        documentId: document.id,
        originalName: document.originalName,
        mimeType: document.mimeType,
        expectedBytes: document.sizeBytes,
        downloadedBytes: data.size,
        durationMs: Date.now() - startedAt,
        status: documentStatus,
      });
      await appendProcessingTimeReport([
        `## Documento: ${document.originalName}`,
        `- Documento ID: \`${document.id}\``,
        `- Status: ${documentStatus}`,
        `- Iniciado em: ${new Date(startedAt).toISOString()}`,
        `- Finalizado em: ${new Date().toISOString()}`,
        `- Tempo total: ${formatDuration(Date.now() - startedAt)}`,
        `- Falhas nao bloqueantes: ${nonBlockingFailures.length}`,
      ].join('\n'));
    } catch (error) {
      await markDocumentFailed(
        document.id,
        error instanceof Error ? error.message : String(error),
      );
      console.log('Erro no processamento do documento pelo worker', {
        event: 'monitor.document_processing_failed',
        documentId: document.id,
        originalName: document.originalName,
        durationMs: Date.now() - startedAt,
        error,
      });
      await appendProcessingTimeReport([
        `## Documento: ${document.originalName}`,
        `- Documento ID: \`${document.id}\``,
        '- Status: FAILED',
        `- Iniciado em: ${new Date(startedAt).toISOString()}`,
        `- Finalizado em: ${new Date().toISOString()}`,
        `- Tempo total: ${formatDuration(Date.now() - startedAt)}`,
        `- Erro: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'));
      throw error;
    }
  }

  private async skipOperations(
    documentId: string,
    operations: DocumentProcessingOperation[],
    reason: string,
  ) {
    for (const operation of operations) {
      await skipDocumentProcessingJob(documentId, operation, { reason });
    }
  }

  private async runTrackedOperation<T>(
    documentId: string,
    operation: DocumentProcessingOperation,
    action: () => Promise<T>,
    inputSnapshot?: Prisma.InputJsonValue,
    context: DocumentWorkerContext = {},
  ) {
    const startedAt = Date.now();
    await startDocumentProcessingJob(documentId, operation, inputSnapshot);
    try {
      const result = await action();
      const outputSummary = sanitizeFlashcardOutputSummary(result);
      outputSummary.durationMs = Date.now() - startedAt;
      const operationStatus = resolveTrackedOperationStatus(result);
      if (operationStatus === 'FAILED' || operationStatus === 'PARTIAL_SUCCESS') {
        outputSummary.status = operationStatus;
        if (operationStatus === 'FAILED') {
          await failDocumentProcessingJob(documentId, operation, new Error('Falha total na geracao de flashcards.'), outputSummary);
          return result;
        }
      }
      await completeDocumentProcessingJob(documentId, operation, {
        ...outputSummary,
      }, operationStatus === 'PARTIAL_SUCCESS' ? 'PARTIAL_SUCCESS' : 'READY');
      return result;
    } catch (error) {
      await failDocumentProcessingJob(documentId, operation, error);
      console.log('Operacao de processamento falhou', {
        event: 'monitor.document_processing_operation_failed',
        documentId,
        operation,
        jobId: context.jobId,
        attempt: context.attempt,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }
}
