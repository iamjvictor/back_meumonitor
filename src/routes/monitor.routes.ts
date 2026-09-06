import type { FastifyInstance } from 'fastify';
import { MonitorController } from '../controllers/monitor.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { MonitorRepository } from '../repositories/monitor.repository.js';
import { MonitorService } from '../services/monitor.service.js';

export async function monitorRoutes(app: FastifyInstance) {
  const controller = new MonitorController(new MonitorService(new MonitorRepository()));

  app.get('/', { onRequest: authMiddleware }, controller.listMine.bind(controller));
  app.get<{ Params: { monitorId: string } }>('/:monitorId', { onRequest: authMiddleware }, controller.getMine.bind(controller));
  app.patch<{ Params: { monitorId: string }; Body: { name?: string; description?: string | null } }>('/:monitorId', { onRequest: authMiddleware }, controller.update.bind(controller));
  app.post('/', {
    onRequest: authMiddleware,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, controller.createDraft.bind(controller));

  app.post<{ Params: { monitorId: string }; Body: { name: string } }>('/:monitorId/subjects', { onRequest: authMiddleware }, controller.addSubject.bind(controller));
  app.delete<{ Params: { monitorId: string; subjectId: string } }>('/:monitorId/subjects/:subjectId', { onRequest: authMiddleware }, controller.deleteSubject.bind(controller));
  app.post<{ Params: { monitorId: string; subjectId: string }; Body: { name: string; definition?: string } }>('/:monitorId/subjects/:subjectId/topics', { onRequest: authMiddleware }, controller.addTopic.bind(controller));
  app.delete<{ Params: { monitorId: string; subjectId: string; topicId: string } }>('/:monitorId/subjects/:subjectId/topics/:topicId', { onRequest: authMiddleware }, controller.deleteTopic.bind(controller));
}
