import { PDFParse } from 'pdf-parse';
import { Prisma } from '@prisma/client';
import { supabaseAdmin } from '../../lib/supabase.js';
import {
  findDocumentForProcessing,
  markDocumentProcessing,
  markDocumentPartialSuccess,
  markDocumentReady,
  markDocumentNeedsOcr,
} from '../../repositories/document-worker.repository.js';
import { ChunkService } from './chunk.service.js';
import { DocumentBlockDetectionService } from './document-block-detection.service.js';
import { DOCUMENT_PROCESSING_VERSION } from '../../repositories/document-processing-job.repository.js';
import { DocumentTextExtractionService } from './document-text-extraction.service.js';
import { DocumentBlockTopicClassificationService } from './document-block-topic-classification.service.js';
import { EmbeddingService } from './embedding.service.js';
import { QuestionExtractionService } from './question-extraction.service.js';
import { TopicProfileGenerationService } from './topic-profile-generation.service.js';
import { appendProcessingTimeReport, formatDuration } from './processing-time-report.service.js';
import {
  completeDocumentProcessingJob,
  ensureDocumentProcessingJobs,
  failDocumentProcessingJob,
  skipDocumentProcessingJob,
  startDocumentProcessingJob,
  type DocumentProcessingOperation,
} from '../../repositories/document-processing-job.repository.js';

const BUCKET = 'monitor-documents';

export type DocumentWorkerContext = {
  jobId?: string;
  attempt?: number;
};

export class DocumentWorkerService {
  constructor(
    private readonly chunkService = new ChunkService(),
    private readonly documentTextExtractionService = new DocumentTextExtractionService(),
    private readonly documentBlockDetectionService = new DocumentBlockDetectionService(),
    private readonly documentBlockTopicClassificationService = new DocumentBlockTopicClassificationService(),
    private readonly embeddingService = new EmbeddingService(),
    private readonly questionExtractionService = new QuestionExtractionService(),
    private readonly topicProfileGenerationService = new TopicProfileGenerationService(),
  ) {}

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

    console.log('Documento encontrado para processamento', {
      event: 'monitor.document_loaded',
      documentId: document.id,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      storagePath: document.storagePath,
    });

    await ensureDocumentProcessingJobs(document.id);
    const track = <T>(
      operation: DocumentProcessingOperation,
      action: () => Promise<T>,
      inputSnapshot?: Prisma.InputJsonValue,
    ) => this.runTrackedOperation(document.id, operation, action, inputSnapshot, context);
    console.log('Jobs de processamento garantidos', {
      event: 'monitor.document_processing_jobs_ready',
      documentId: document.id,
      processingVersion: DOCUMENT_PROCESSING_VERSION,
    });

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

    console.log('Documento marcado como PROCESSING', {
      event: 'monitor.document_processing_status_updated',
      documentId: document.id,
      status: 'PROCESSING',
    });

    try {
      console.log('Worker iniciando download do documento', {
        event: 'monitor.document_storage_download_started',
        documentId: document.id,
        bucket: BUCKET,
        storagePath: document.storagePath,
      });

      const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(document.storagePath);
      if (error || !data) throw new Error(error?.message || 'Arquivo nao encontrado no storage.');

      if (document.tag === 'KNOWLEDGE_BASE' || document.tag === 'FLASHCARDS') {
        console.log('Iniciando extracao de texto da base de conhecimento', {
          event: 'monitor.document_text_extraction_started',
          documentId: document.id,
          originalName: document.originalName,
        });

        const parsedPdf = await track(
          'EXTRACT_TEXT',
          async () => {
            const parser = new PDFParse({ data: Buffer.from(await data.arrayBuffer()) });
            try {
              return await parser.getText();
            } finally {
              await parser.destroy();
            }
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
          { extractionVersion: 'pdf-parse-v2' },
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
            'CLASSIFY_BLOCKS',
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

        try {
          await track(
            'CLASSIFY_BLOCKS',
            () => this.documentBlockTopicClassificationService.process(document.id, textExtraction.documentTextId),
            { documentTextId: textExtraction.documentTextId },
          );
        } catch (error) {
          nonBlockingFailures.push({ operation: 'CLASSIFY_BLOCKS', error });
          await this.documentBlockTopicClassificationService.markPending(
            textExtraction.documentTextId,
          );
          console.log('Classificacao de topicos ficou pendente; processamento continuara', {
            event: 'monitor.document_block_topics_failed_non_blocking',
            documentId: document.id,
            documentTextId: textExtraction.documentTextId,
            error,
          });
        }

        await track(
          'CREATE_RETRIEVAL_CHUNKS',
          () => this.chunkService.processDocument(document.id, textExtraction.documentTextId),
          { documentTextId: textExtraction.documentTextId },
        );

        let embeddingResult = { chunkCount: 0, batchCount: 0 };
        try {
          embeddingResult = await track(
            'GENERATE_CHUNK_EMBEDDINGS',
            () => this.embeddingService.processDocument(document.id),
            { embeddingModel: 'configured-openrouter-model' },
          );
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

        if (document.tag === 'KNOWLEDGE_BASE') {
          try {
            const questionResult = await track(
              'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
              () => this.questionExtractionService.processDocument(document.id),
              { documentTag: document.tag },
            );
            await track(
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

        await skipDocumentProcessingJob(
          document.id,
          'GENERATE_FLASHCARD_CANDIDATES',
          { reason: 'automatic_flashcard_generation_disabled' },
        );
        console.log('Geracao automatica de flashcards desativada', {
          event: 'monitor.flashcard_generation_skipped_disabled',
          documentId: document.id,
        });

        if (document.tag === 'FLASHCARDS') {
          await this.skipOperations(document.id, [
            'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
            'MATCH_ANSWER_KEYS',
          ], 'document_tag_flashcards');
        }

      }

      if (document.tag !== 'KNOWLEDGE_BASE' && document.tag !== 'FLASHCARDS') {
        await this.skipOperations(document.id, [
          'EXTRACT_TEXT',
          'NORMALIZE_TEXT',
          'DETECT_BLOCKS',
          'CLASSIFY_BLOCKS',
          'CREATE_RETRIEVAL_CHUNKS',
          'GENERATE_CHUNK_EMBEDDINGS',
          'EXTRACT_QUESTIONS_TO_PENDING_REVIEW',
          'MATCH_ANSWER_KEYS',
          'GENERATE_FLASHCARD_CANDIDATES',
        ], `document_tag_${document.tag.toLowerCase()}_not_supported_yet`);
      }

      console.log('Download do documento concluido', {
        event: 'monitor.document_storage_download_completed',
        documentId: document.id,
        expectedBytes: document.sizeBytes,
        downloadedBytes: data.size,
        durationMs: Date.now() - startedAt,
      });

      if (nonBlockingFailures.length > 0) {
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
        { documentStatus: nonBlockingFailures.length > 0 ? 'PARTIAL_SUCCESS' : 'READY' },
      );

      console.log('Documento processado pelo worker', {
        event: 'monitor.document_worker_completed',
        documentId: document.id,
        originalName: document.originalName,
        mimeType: document.mimeType,
        expectedBytes: document.sizeBytes,
        downloadedBytes: data.size,
        durationMs: Date.now() - startedAt,
        status: nonBlockingFailures.length > 0 ? 'PARTIAL_SUCCESS' : 'READY',
      });
      await appendProcessingTimeReport([
        `## Documento: ${document.originalName}`,
        `- Documento ID: \`${document.id}\``,
        `- Status: ${nonBlockingFailures.length > 0 ? 'PARTIAL_SUCCESS' : 'READY'}`,
        `- Iniciado em: ${new Date(startedAt).toISOString()}`,
        `- Finalizado em: ${new Date().toISOString()}`,
        `- Tempo total: ${formatDuration(Date.now() - startedAt)}`,
        `- Falhas nao bloqueantes: ${nonBlockingFailures.length}`,
      ].join('\n'));
    } catch (error) {
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
      console.log('Operacao de processamento ignorada', {
        event: 'monitor.document_processing_operation_skipped',
        documentId,
        operation,
        reason,
      });
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
    console.log('Operacao de processamento iniciada', {
      event: 'monitor.document_processing_operation_started',
      documentId,
      operation,
      processingVersion: DOCUMENT_PROCESSING_VERSION,
      jobId: context.jobId,
      attempt: context.attempt,
    });

    try {
      const result = await action();
      const outputSummary: Record<string, Prisma.InputJsonValue> = {
        durationMs: Date.now() - startedAt,
        status: 'READY',
      };
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const summaryKeys = [
          'chunkCount', 'batchCount', 'blockCount', 'typeCounts', 'reviewCount',
          'savedCount', 'duplicateCount', 'questionCount', 'detectedCount',
          'incompleteCount', 'sourceBlockCount', 'candidateCount',
        ] as const;
        for (const key of summaryKeys) {
          const value = (result as Record<string, unknown>)[key];
          if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            outputSummary[key] = value;
          } else if (value && typeof value === 'object') {
            outputSummary[key] = value as Prisma.InputJsonValue;
          }
        }
      }
      await completeDocumentProcessingJob(documentId, operation, {
        ...outputSummary,
      });
      console.log('Operacao de processamento concluida', {
        event: 'monitor.document_processing_operation_completed',
        documentId,
        operation,
        jobId: context.jobId,
        attempt: context.attempt,
        durationMs: Date.now() - startedAt,
      });
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
