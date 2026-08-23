import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadDocumentSchema } from '../models/document.model.js';
import { DocumentRepositoryError } from '../repositories/document.repository.js';
import { DocumentQueueError, DocumentService } from '../services/document.service.js';

type DocumentParams = { monitorId: string };
type ProcessingParams = { monitorId: string; documentId: string };

export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  async upload(request: FastifyRequest<{ Params: DocumentParams }>, reply: FastifyReply) {
    const startedAt = Date.now();

    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem enviar documentos.' });

    console.log('Upload de documento recebido', {
      event: 'monitor.document_upload_received',
      requestId: request.id,
      userId: request.user.id,
      monitorId: request.params.monitorId,
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'],
    });

    const fields: Record<string, string> = {};
    let uploadedFile: { filename: string; mimetype: string; buffer: Buffer } | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (uploadedFile) return reply.code(400).send({ error: 'TOO_MANY_FILES', message: 'Envie apenas um arquivo por requisicao.' });

          console.log('Arquivo recebido no multipart', {
            event: 'monitor.document_file_received',
            requestId: request.id,
            filename: part.filename,
            mimeType: part.mimetype,
          });

          // O stream precisa ser consumido antes de continuar iterando o multipart.
          const buffer = await part.toBuffer();
          uploadedFile = {
            filename: part.filename,
            mimetype: part.mimetype,
            buffer,
          };

          console.log('Conteudo do arquivo recebido', {
            event: 'monitor.document_file_buffered',
            requestId: request.id,
            filename: part.filename,
            sizeBytes: buffer.length,
          });
        } else {
          fields[part.fieldname] = String(part.value);
          console.log('Campo recebido no multipart', {
            event: 'monitor.document_field_received',
            requestId: request.id,
            field: part.fieldname,
            value: part.fieldname === 'tag' || part.fieldname.endsWith('Id') ? String(part.value) : '[omitted]',
          });
        }
      }

      if (!uploadedFile) return reply.code(400).send({ error: 'FILE_REQUIRED', message: 'Envie um arquivo no campo file.' });

      const parsed = uploadDocumentSchema.safeParse({
        subjectId: fields.subjectId,
        topicId: fields.topicId || undefined,
        tag: fields.tag,
      });

      if (!parsed.success) {
        console.log('Upload rejeitado na validacao dos campos', {
          event: 'monitor.document_upload_validation_failed',
          requestId: request.id,
          userId: request.user.id,
          monitorId: request.params.monitorId,
          invalidFields: Object.keys(parsed.error.flatten().fieldErrors),
        });
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Escopo ou tag do documento invalidos.',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      console.log('Arquivo convertido para buffer', {
        event: 'monitor.document_buffer_ready',
        requestId: request.id,
        filename: uploadedFile.filename,
        sizeBytes: uploadedFile.buffer.length,
        tag: parsed.data.tag,
        subjectId: parsed.data.subjectId,
        topicId: parsed.data.topicId,
      });

      console.log('Iniciando salvamento do documento', {
        event: 'monitor.document_save_started',
        requestId: request.id,
        userId: request.user.id,
        monitorId: request.params.monitorId,
        filename: uploadedFile.filename,
        tag: parsed.data.tag,
      });

      const result = await this.service.upload(request.user.id, request.params.monitorId, parsed.data, {
        buffer: uploadedFile.buffer,
        originalName: uploadedFile.filename,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.buffer.length,
      });

      if (result.kind === 'SCOPE_NOT_FOUND') {
        console.log('Escopo do documento nao encontrado', {
          event: 'monitor.document_scope_not_found',
          requestId: request.id,
          monitorId: request.params.monitorId,
          subjectId: parsed.data.subjectId,
          topicId: parsed.data.topicId,
        });
        return reply.code(404).send({ error: 'DOCUMENT_SCOPE_NOT_FOUND', message: 'A materia ou especifica nao pertence a este Monitor de IA.' });
      }

      console.log('Documento colocado na fila', {
        event: 'monitor.document_upload_completed',
        requestId: request.id,
        userId: request.user.id,
        monitorId: request.params.monitorId,
        documentId: result.document.id,
        tag: result.document.tag,
        status: result.document.status,
        durationMs: Date.now() - startedAt,
      });

      console.log('Resposta do upload enviada', {
        event: 'monitor.document_upload_response_sent',
        requestId: request.id,
        documentId: result.document.id,
        statusCode: 201,
        durationMs: Date.now() - startedAt,
      });

      return reply.code(201).send({ data: result.document });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'DOCUMENT_TOO_LARGE', message: 'O arquivo deve ter no maximo 5 MB.' });
      }

      if (error instanceof DocumentRepositoryError) {
        console.log('Falha no storage do documento', { event: 'monitor.document_storage_failed', requestId: request.id, userId: request.user.id, error });
        return reply.code(502).send({ error: 'DOCUMENT_STORAGE_FAILED', message: 'Nao foi possivel salvar o documento.' });
      }

      if (error instanceof DocumentQueueError) {
        console.log('Falha ao publicar documento na fila BullMQ', {
          event: 'monitor.document_queue_publish_failed',
          requestId: request.id,
          userId: request.user.id,
          error,
        });
        return reply.code(503).send({ error: 'DOCUMENT_QUEUE_UNAVAILABLE', message: 'A fila de processamento esta indisponivel. Tente novamente.' });
      }

      console.log('Falha ao colocar documento na fila', {
        event: 'monitor.document_upload_failed',
        requestId: request.id,
        userId: request.user.id,
        monitorId: request.params.monitorId,
        error,
      });
      return reply.code(500).send({ error: 'DOCUMENT_UPLOAD_FAILED', message: 'Nao foi possivel enviar o documento.' });
    }
  }

  async processingStatus(
    request: FastifyRequest<{ Params: ProcessingParams }>,
    reply: FastifyReply,
  ) {
    if (!request.user) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    }

    const document = await this.service.findProcessingStatus(
      request.user.id,
      request.params.monitorId,
      request.params.documentId,
    );

    if (!document) {
      return reply.code(404).send({ error: 'DOCUMENT_NOT_FOUND', message: 'Documento nao encontrado.' });
    }

    return reply.send({ data: document });
  }

  async reprocess(
    request: FastifyRequest<{ Params: ProcessingParams }>,
    reply: FastifyReply,
  ) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem reprocessar documentos.' });

    const result = await this.service.reprocess(
      request.user.id,
      request.params.monitorId,
      request.params.documentId,
    );
    if (!result) return reply.code(404).send({ error: 'DOCUMENT_NOT_FOUND', message: 'Documento nao encontrado.' });
    return reply.code(202).send({ data: result });
  }
}
