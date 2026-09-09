import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';

export type StudentPerformanceRow = {
  monitorId: string;
  monitorName: string;
  subjectId: string;
  subjectName: string;
  topicId: string | null;
  topicName: string | null;
  answeredCount: number;
  correctCount: number;
  lastAnsweredAt: string | null;
};

export type StudentFlashcardPerformanceRow = {
  monitorId: string;
  monitorName: string;
  subjectId: string;
  subjectName: string;
  topicId: string | null;
  topicName: string | null;
  reviewedCount: number;
  retainedCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  lastReviewedAt: string | null;
};

export class StudentPerformanceRepository {
  async findStudentByUserId(userId: string) {
    return prisma.student.findUnique({ where: { userId }, select: { id: true } });
  }

  async aggregateByScope(studentId: string, monitorIds: string[]): Promise<StudentPerformanceRow[]> {
    if (monitorIds.length === 0) return [];

    return prisma.$queryRaw<StudentPerformanceRow[]>`
      SELECT
        m.id AS "monitorId",
        m.name AS "monitorName",
        subjects.id AS "subjectId",
        subjects.name AS "subjectName",
        topics.id AS "topicId",
        topics.name AS "topicName",
        COUNT(attempts.id)::int AS "answeredCount",
        COUNT(*) FILTER (WHERE attempts.is_correct = true)::int AS "correctCount",
        MAX(attempts.answered_at)::text AS "lastAnsweredAt"
      FROM student_question_attempts AS attempts
      INNER JOIN monitors AS m ON m.id = attempts.monitor_id
      INNER JOIN questions AS questions ON questions.id = attempts.question_id
      INNER JOIN monitor_subjects AS subjects ON subjects.id = questions.subject_id
      LEFT JOIN monitor_topics AS topics ON topics.id = questions.topic_id
      WHERE attempts.student_id = ${studentId}::uuid
        AND attempts.monitor_id IN (${Prisma.join(monitorIds)})
      GROUP BY m.id, m.name, subjects.id, subjects.name, topics.id, topics.name
      ORDER BY m.name ASC, subjects.name ASC, topics.name ASC NULLS LAST
    `;
  }

  async aggregateFlashcardByScope(studentId: string, monitorIds: string[]): Promise<StudentFlashcardPerformanceRow[]> {
    if (monitorIds.length === 0) return [];

    return prisma.$queryRaw<StudentFlashcardPerformanceRow[]>`
      SELECT
        m.id AS "monitorId",
        m.name AS "monitorName",
        subjects.id AS "subjectId",
        subjects.name AS "subjectName",
        topics.id AS "topicId",
        topics.name AS "topicName",
        COUNT(logs.id)::int AS "reviewedCount",
        COUNT(*) FILTER (WHERE logs.rating IN ('GOOD', 'EASY'))::int AS "retainedCount",
        COUNT(*) FILTER (WHERE logs.rating = 'AGAIN')::int AS "againCount",
        COUNT(*) FILTER (WHERE logs.rating = 'HARD')::int AS "hardCount",
        COUNT(*) FILTER (WHERE logs.rating = 'GOOD')::int AS "goodCount",
        COUNT(*) FILTER (WHERE logs.rating = 'EASY')::int AS "easyCount",
        MAX(logs.reviewed_at)::text AS "lastReviewedAt"
      FROM student_flashcard_review_logs AS logs
      INNER JOIN flashcards AS f ON f.id = logs.flashcard_id
      INNER JOIN monitors AS m ON m.id = f.monitor_id
      INNER JOIN monitor_subjects AS subjects ON subjects.id = f.subject_id
      LEFT JOIN monitor_topics AS topics ON topics.id = f.topic_id
      WHERE logs.student_id = ${studentId}::uuid
        AND f.monitor_id IN (${Prisma.join(monitorIds)})
      GROUP BY m.id, m.name, subjects.id, subjects.name, topics.id, topics.name
      ORDER BY m.name ASC, subjects.name ASC, topics.name ASC NULLS LAST
    `;
  }

  async getFlashcardOverview(studentId: string, monitorIds: string[]) {
    if (monitorIds.length === 0) return { dueCount: 0, totalCardsCount: 0 };

    const now = new Date();
    const [dueCount, totalCardsCount] = await Promise.all([
      prisma.studentFlashcardProgress.count({
        where: {
          studentId,
          nextReviewAt: { lte: now },
          flashcard: { monitorId: { in: monitorIds } },
        },
      }),
      prisma.flashcard.count({
        where: { monitorId: { in: monitorIds } },
      }),
    ]);

    return { dueCount, totalCardsCount };
  }
}

