import type { UploadDocumentInput } from '../models/document.model.js';
import { documentQueue } from '../queues/document.queue.js';
import { DocumentRepository } from '../repositories/document.repository.js';
import { findDocumentProcessingStatus } from '../repositories/document-processing-job.repository.js';

export class DocumentService {
  constructor(private readonly repository: DocumentRepository) {}

  async upload(
    userId: string,
    monitorId: string,
    input: UploadDocumentInput,
    file: { buffer: Buffer; originalName: string; mimeType: string; sizeBytes: number },
  ) {
    const document = await this.repository.save(userId, monitorId, input, file);
    if (document.kind === 'SCOPE_NOT_FOUND') return document;

    try {
      await documentQueue.add('process-document', { documentId: document.document.id }, { jobId: document.document.id });
    } catch (error) {
      throw new DocumentQueueError(error instanceof Error ? error.message : 'Falha ao publicar job no Redis.');
    }

    console.log('Documento salvo e colocado na fila', {
      event: 'monitor.document_service_completed',
      documentId: document.document.id,
      status: document.document.status,
    });
    return document;
  }

  async findProcessingStatus(userId: string, monitorId: string, documentId: string) {
    return findDocumentProcessingStatus(userId, monitorId, documentId);
  }

  async reprocess(userId: string, monitorId: string, documentId: string) {
    const document = await this.repository.prepareForReprocessing(userId, monitorId, documentId);
    if (!document) return null;

    const jobId = `reprocess-${document.id}-${Date.now()}`;
    await documentQueue.add('process-document', { documentId: document.id }, {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 1000 },
    });
    return { ...document, jobId };
  }
}

export class DocumentQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentQueueError';
  }
}
