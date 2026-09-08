import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StudentContentReportService } from '../services/student-content-report.service.js';
import { StudentRepository } from '../../../repositories/student.repository.js';
import { authMiddleware } from '../../../middleware/auth.middleware.js';

const reportBodySchema = z.object({
  targetType: z.enum(['QUESTION', 'FLASHCARD']),
  questionId: z.string().uuid().optional(),
  flashcardId: z.string().uuid().optional(),
  reason: z.string().min(1),
  description: z.string().max(5000).optional(),
}).strict();

export async function studentContentReportRoutes(app: FastifyInstance) {
  const service = new StudentContentReportService();
  const studentRepo = new StudentRepository();

  app.post('/reports', { onRequest: authMiddleware }, async (request, reply) => {
    try {
      const userId = request.user?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'Usuário não autenticado.' });
      }

      const student = await studentRepo.findByUserId(userId);
      if (!student) {
        return reply.status(403).send({ error: 'Apenas alunos podem reportar problemas.' });
      }
      
      const studentId = student.id;

      const body = reportBodySchema.parse(request.body);

      const report = await service.createReport({
        studentId,
        targetType: body.targetType,
        questionId: body.questionId,
        flashcardId: body.flashcardId,
        reason: body.reason,
        description: body.description,
      });

      return reply.status(201).send(report);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Dados inválidos.', details: error.issues });
      }
      if (error instanceof Error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Erro interno do servidor.' });
    }
  });
}
