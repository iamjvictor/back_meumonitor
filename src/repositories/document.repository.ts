import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { UploadDocumentInput } from '../models/document.model.js';
import { documentTagToDatabase } from '../models/document.model.js';
import { DOCUMENT_PROCESSING_VERSION, ensureDocumentProcessingJobs } from './document-processing-job.repository.js';
import { compressPdfForStorage, STORAGE_FILE_LIMIT_BYTES } from '../services/pdf-compression.service.js';

const BUCKET = 'monitor-documents';

export class DocumentRepository {
  async save(
    userId: string,
    monitorId: string,
    input: UploadDocumentInput,
    file: { buffer: Buffer; originalName: string; mimeType: string; sizeBytes: number },
  ) {
    console.log('Repository validando escopo do documento', {
      event: 'monitor.document_scope_validation_started',
      userId,
      monitorId,
      subjectId: input.subjectId,
      topicId: input.topicId,
    });

    const scope = await prisma.monitor.findFirst({
      where: {
        id: monitorId,
        teacher: { userId },
        subjects: {
          some: {
            id: input.subjectId,
            ...(input.topicId ? { topics: { some: { id: input.topicId } } } : {}),
          },
        },
      },
      select: { id: true, teacherId: true },
    });

    if (!scope) return { kind: 'SCOPE_NOT_FOUND' as const };

    const topicIds = input.topicId
      ? [input.topicId]
      : (await prisma.monitorTopic.findMany({
          where: { subjectId: input.subjectId },
          select: { id: true },
          orderBy: { position: 'asc' },
        })).map((topic) => topic.id);

    console.log('Escopo do documento validado', {
      event: 'monitor.document_scope_validation_completed',
      monitorId,
      subjectId: input.subjectId,
      topicId: input.topicId,
      teacherId: scope.teacherId,
    });

    const documentId = randomUUID();
    const safeName = file.originalName
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 180);
    const scopeFolder = input.topicId || 'subject';
    const storagePath = `${scope.teacherId}/${monitorId}/${input.subjectId}/${scopeFolder}/${documentId}-${safeName || 'document'}`;

    const preparedFile = await compressPdfForStorage({
      buffer: file.buffer,
      originalName: file.originalName,
      mimeType: file.mimeType,
      diagnosticFileName: `${documentId}-${safeName || 'document'}`,
    });

    console.log('Iniciando upload do documento no Storage', {
      event: 'monitor.document_storage_upload_started',
      bucket: BUCKET,
      storagePath,
      originalSizeBytes: preparedFile.originalSizeBytes,
      sizeBytes: preparedFile.finalSizeBytes,
      compressed: preparedFile.compressed,
      compressionProfile: preparedFile.profile,
      localDiagnosticPath: preparedFile.localDiagnosticPath,
      storageLimitBytes: STORAGE_FILE_LIMIT_BYTES,
      mimeType: file.mimeType,
    });

    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, preparedFile.buffer, {
      contentType: file.mimeType,
      cacheControl: '3600',
      upsert: false,
    });

    if (uploadError) throw new DocumentRepositoryError(uploadError.message);

    console.log('Documento salvo no Storage', {
      event: 'monitor.document_storage_upload_completed',
      bucket: BUCKET,
      storagePath,
      originalSizeBytes: preparedFile.originalSizeBytes,
      sizeBytes: preparedFile.finalSizeBytes,
      compressed: preparedFile.compressed,
      compressionProfile: preparedFile.profile,
      localDiagnosticPath: preparedFile.localDiagnosticPath,
    });

    try {
      const document = await prisma.monitorDocument.create({
        data: {
          id: documentId,
          teacherId: scope.teacherId,
          monitorId,
          subjectId: input.subjectId,
          topicId: input.topicId || null,
          tag: documentTagToDatabase[input.tag],
          originalName: file.originalName,
          storagePath,
          mimeType: file.mimeType,
          sizeBytes: preparedFile.finalSizeBytes,
          status: 'QUEUED',
          processingVersion: DOCUMENT_PROCESSING_VERSION,
          topicLinks: {
            create: topicIds.map((topicId) => ({ topicId })),
          },
        },
      });

      console.log('Registro do documento criado no banco', {
        event: 'monitor.document_database_record_created',
        documentId: document.id,
        monitorId: document.monitorId,
        subjectId: document.subjectId,
        topicId: document.topicId,
        tag: document.tag,
        status: document.status,
      });

      return { kind: 'CREATED' as const, document };
    } catch (error) {
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }
  }

  async prepareForReprocessing(userId: string, monitorId: string, documentId: string) {
    const document = await prisma.monitorDocument.findFirst({
      where: { id: documentId, monitorId, monitor: { teacher: { userId } } },
      select: { id: true, status: true },
    });
    if (!document) return null;

    await prisma.monitorDocument.update({
      where: { id: document.id },
      data: { status: 'QUEUED', errorMessage: null, processingVersion: DOCUMENT_PROCESSING_VERSION },
    });
    await ensureDocumentProcessingJobs(document.id);
    return { id: document.id, processingVersion: DOCUMENT_PROCESSING_VERSION };
  }
}

export class DocumentRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRepositoryError';
  }
}
