import type { FastifyInstance } from 'fastify';
import { DocumentController } from '../controllers/document.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { DocumentRepository } from '../repositories/document.repository.js';
import { DocumentService } from '../services/document.service.js';

export async function documentRoutes(app: FastifyInstance) {
  const controller = new DocumentController(new DocumentService(new DocumentRepository()));

  app.post<{ Params: { monitorId: string } }>('/:monitorId/documents', {
    onRequest: authMiddleware,
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, controller.upload.bind(controller));

  app.get<{ Params: { monitorId: string; documentId: string } }>(
    '/:monitorId/documents/:documentId/processing',
    { onRequest: authMiddleware },
    controller.processingStatus.bind(controller),
  );

  app.post<{ Params: { monitorId: string; documentId: string } }>(
    '/:monitorId/documents/:documentId/reprocess',
    { onRequest: authMiddleware },
    controller.reprocess.bind(controller),
  );
}
