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
}
