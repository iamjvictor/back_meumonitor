import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TeacherPracticePreviewService } from '../services/teacher-practice-preview.service.js';

const answerSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswer: z.string().trim().min(1).max(500),
});
const flashcardParamsSchema = z.object({ flashcardId: z.string().min(1) });
const flashcardRatingSchema = z.object({ rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']) }).strict();

const errorStatus: Record<string, number> = {
  TEACHER_NOT_FOUND: 403,
  QUESTION_NOT_ACCESSIBLE: 404,
  FLASHCARD_NOT_ACCESSIBLE: 404,
  NO_FLASHCARDS_FOUND: 404,
};

export class TeacherPracticePreviewController {
  constructor(private readonly service: TeacherPracticePreviewService) {}

  private fail(reply: FastifyReply, error: unknown) {
    const code = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return reply.code(errorStatus[code] ?? 500).send({
      error: errorStatus[code] ? code : 'INTERNAL_SERVER_ERROR',
      message: 'Não foi possível executar a pré-visualização da prática.',
    });
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const query = request.query as { monitorId?: string; subjectId?: string; topicId?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
    console.log('Prática de professor em modo preview iniciada', { event: 'teacher.practice_preview_list_started', requestId: request.id, userId: request.user.id, monitorId: query.monitorId ?? null, page, pageSize });
    try {
      const data = await this.service.listQuestions(request.user.id, { monitorId: query.monitorId, subjectId: query.subjectId, topicId: query.topicId, page, pageSize });
      console.log('Questões de preview do professor carregadas', { event: 'teacher.practice_preview_list_completed', requestId: request.id, userId: request.user.id, count: data.questions.length, total: data.total });
      return reply.send({ data: { ...data, page, pageSize, preview: true } });
    } catch (error) {
      return this.fail(reply, error);
    }
  }

  async answer(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const parsed = answerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    console.log('Resposta de preview do professor recebida', { event: 'teacher.practice_preview_answer_started', requestId: request.id, userId: request.user.id, questionId: parsed.data.questionId });
    try {
      const data = await this.service.answer(request.user.id, parsed.data);
      console.log('Resposta de preview do professor processada', { event: 'teacher.practice_preview_answer_completed', requestId: request.id, userId: request.user.id, questionId: parsed.data.questionId, isCorrect: data.isCorrect, persistedStudentAttempt: false });
      return reply.send({ data: { ...data, preview: true } });
    } catch (error) {
      return this.fail(reply, error);
    }
  }

  async randomFlashcard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const query = request.query as { monitorId?: string; subjectId?: string; topicId?: string; excludeFlashcardId?: string };
    try {
      const card = await this.service.getRandomFlashcard(request.user.id, query);
      return reply.send({ data: {
        id: card.id,
        monitorId: card.monitorId,
        subjectId: card.subjectId,
        topicId: card.topicId,
        subject: card.subject?.name || 'Geral',
        topic: card.topic?.name || 'Geral',
        monitorName: card.monitor?.name || 'Meu Monitor AI',
        question: card.front,
        answer: card.back,
        cardStatus: card.cardStatus,
        preview: true,
      } });
    } catch (error) {
      return this.fail(reply, error);
    }
  }

  async reviewFlashcard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const params = flashcardParamsSchema.safeParse(request.params);
    const body = flashcardRatingSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_RATING' });
    try {
      const data = await this.service.reviewFlashcard(request.user.id, params.data.flashcardId, body.data.rating);
      return reply.send({ data });
    } catch (error) {
      return this.fail(reply, error);
    }
  }
}
