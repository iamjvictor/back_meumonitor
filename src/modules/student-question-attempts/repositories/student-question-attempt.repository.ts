import { prisma } from '../../../lib/prisma.js';
import type { StudentQuestionAttemptInput } from '../models/student-question-attempt.model.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class StudentQuestionAttemptRepository {
  async findStudentByUserId(userId: string) {
    log('monitor.student_question_attempt_db_student_lookup_started', { userId });
    const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
    log('monitor.student_question_attempt_db_student_lookup_completed', { userId, studentId: student?.id ?? null, found: Boolean(student) });
    return student;
  }

  async findAccessibleMonitorIds(studentId: string, userId: string) {
    const now = new Date();
    const [subscriptions, enrollments, teacher] = await Promise.all([
      prisma.studentSubscription.findMany({ where: { studentId, status: 'active', startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, select: { monitorId: true } }),
      prisma.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] }, select: { monitorId: true } }),
      prisma.teacher.findUnique({ where: { userId }, select: { id: true } }),
    ]);

    const teacherMonitorIds = teacher
      ? (await prisma.monitor.findMany({ where: { teacherId: teacher.id }, select: { id: true } })).map((monitor) => monitor.id)
      : [];

    return Array.from(new Set([
      ...subscriptions.map((item) => item.monitorId),
      ...enrollments.map((item) => item.monitorId),
      ...teacherMonitorIds,
    ]));
  }

  async listApprovedQuestions(input: { monitorIds: string[]; monitorId?: string; subjectId?: string; topicId?: string; page: number; pageSize: number; studentId: string }) {
    const monitorIds = input.monitorId ? input.monitorIds.filter((id) => id === input.monitorId) : input.monitorIds;
    const where = {
      monitorId: { in: monitorIds },
      status: 'APPROVED' as const,
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      ...(input.topicId ? { topicId: input.topicId } : {}),
    };
    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          monitorId: true,
          subjectId: true,
          topicId: true,
          text: true,
          alternatives: true,
          kind: true,
          difficulty: true,
          questionBankItem: { select: { imageUrls: true } },
          subject: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          questionAttempts: {
            where: { studentId: input.studentId, mode: 'PRACTICE', status: 'ACTIVE' },
            orderBy: { answeredAt: 'desc' },
            take: 1,
            select: { id: true, selectedAnswer: true, isCorrect: true, answeredAt: true },
          },
        },
      }),
      prisma.question.count({ where }),
    ]);

    const attemptWhere = {
      studentId: input.studentId,
      monitorId: { in: monitorIds },
      mode: 'PRACTICE' as const,
      ...(input.monitorId ? { monitorId: input.monitorId } : {}),
      question: {
        status: 'APPROVED' as const,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.topicId ? { topicId: input.topicId } : {}),
      },
    };
    const [attemptsCount, correctCount, answeredQuestionIds] = await Promise.all([
      prisma.studentQuestionAttempt.count({ where: attemptWhere }),
      prisma.studentQuestionAttempt.count({ where: { ...attemptWhere, isCorrect: true } }),
      prisma.studentQuestionAttempt.findMany({ where: attemptWhere, distinct: ['questionId'], select: { questionId: true } }),
    ]);

    return {
      questions,
      total,
      stats: {
        attemptsCount,
        correctCount,
        answeredQuestionsCount: answeredQuestionIds.length,
        accuracy: attemptsCount > 0 ? Math.round((correctCount / attemptsCount) * 100) : 0,
      },
    };
  }

  async findApprovedQuestion(questionId: string, monitorIds: string[]) {
    log('monitor.student_question_attempt_db_question_lookup_started', { questionId, accessibleMonitorCount: monitorIds.length });
    const question = await prisma.question.findFirst({
      where: { id: questionId, monitorId: { in: monitorIds }, status: 'APPROVED' },
      select: { id: true, monitorId: true, correctAnswer: true, explanation: true },
    });
    log('monitor.student_question_attempt_db_question_lookup_completed', { questionId, found: Boolean(question), monitorId: question?.monitorId ?? null, hasCorrectAnswer: Boolean(question?.correctAnswer) });
    return question;
  }

  async findByIdempotencyKey(idempotencyKey: string, studentId: string) {
    log('monitor.student_question_attempt_db_idempotency_lookup_started', { studentId, idempotencyKey });
    const attempt = await prisma.studentQuestionAttempt.findFirst({ where: { idempotencyKey, studentId } });
    log('monitor.student_question_attempt_db_idempotency_lookup_completed', { studentId, idempotencyKey, found: Boolean(attempt), questionAttemptId: attempt?.id ?? null });
    return attempt;
  }

  async createPracticeAttempt(input: { studentId: string; question: { id: string; monitorId: string; correctAnswer: string | null; explanation: string | null }; data: StudentQuestionAttemptInput }) {
    const isCorrect = input.data.selectedAnswer.trim().toUpperCase() === input.question.correctAnswer?.trim().toUpperCase();
    log('monitor.student_question_attempt_db_create_started', { studentId: input.studentId, questionId: input.question.id, monitorId: input.question.monitorId, mode: input.data.mode, isCorrect: Boolean(input.question.correctAnswer && isCorrect), hasIdempotencyKey: Boolean(input.data.idempotencyKey) });
    try {
      const attempt = await prisma.studentQuestionAttempt.create({
        data: {
          studentId: input.studentId,
          questionId: input.question.id,
          monitorId: input.question.monitorId,
          mode: 'PRACTICE',
          status: 'ACTIVE',
          selectedAnswer: input.data.selectedAnswer.trim(),
          isCorrect: Boolean(input.question.correctAnswer && isCorrect),
          responseTimeMs: input.data.responseTimeMs,
          idempotencyKey: input.data.idempotencyKey,
        },
      });
      log('monitor.student_question_attempt_db_create_completed', { studentId: input.studentId, questionId: input.question.id, questionAttemptId: attempt.id, isCorrect: attempt.isCorrect });
      return attempt;
    } catch (error) {
      const details = error instanceof Error ? { errorName: error.name, errorMessage: error.message, errorCode: (error as Error & { code?: string }).code ?? null, errorMeta: (error as Error & { meta?: unknown }).meta ?? null, stack: error.stack ?? null } : { errorName: typeof error, errorMessage: String(error), errorCode: null, errorMeta: null, stack: null };
      log('monitor.student_question_attempt_db_create_failed', { studentId: input.studentId, questionId: input.question.id, ...details });
      if (input.data.idempotencyKey && (error as { code?: string }).code === 'P2002') {
        const existing = await this.findByIdempotencyKey(input.data.idempotencyKey, input.studentId);
        if (existing) {
          log('monitor.student_question_attempt_db_create_recovered_idempotency', { studentId: input.studentId, questionId: input.question.id, questionAttemptId: existing.id, idempotencyKey: input.data.idempotencyKey });
          return existing;
        }
      }
      throw error;
    }
  }

  async archiveActiveAttempts(input: {
    studentId: string;
    monitorIds: string[];
    monitorId?: string;
    subjectId?: string;
    topicId?: string;
  }) {
    const result = await prisma.studentQuestionAttempt.updateMany({
      where: {
        studentId: input.studentId,
        status: 'ACTIVE',
        monitorId: input.monitorId ? { in: [input.monitorId] } : { in: input.monitorIds },
        question: {
          ...(input.subjectId ? { subjectId: input.subjectId } : {}),
          ...(input.topicId ? { topicId: input.topicId } : {}),
        },
      },
      data: { status: 'ARCHIVED' },
    });

    return result.count;
  }
}
