import { prisma } from '../../../lib/prisma.js';

type ConsistencyRow = {
  day: string;
  weekday: string;
  answeredCount: number;
  responseTimeMs: number;
};

export class StudentConsistencyRepository {
  async findStudentByUserId(userId: string) {
    return prisma.student.findUnique({ where: { userId }, select: { id: true } });
  }

  async aggregateSevenDays(studentId: string, startDate: string, endDateExclusive: string): Promise<ConsistencyRow[]> {
    return prisma.$queryRaw<ConsistencyRow[]>`
      WITH calendar_days AS (
        SELECT day::date
        FROM generate_series(${startDate}::date, (${endDateExclusive}::date - INTERVAL '1 day')::date, INTERVAL '1 day') AS day
      )
      SELECT
        to_char(calendar_days.day, 'YYYY-MM-DD') AS day,
        CASE EXTRACT(ISODOW FROM calendar_days.day)::int
          WHEN 1 THEN 'S'
          WHEN 2 THEN 'T'
          WHEN 3 THEN 'Q'
          WHEN 4 THEN 'Q'
          WHEN 5 THEN 'S'
          WHEN 6 THEN 'S'
          WHEN 7 THEN 'D'
        END AS weekday,
        COUNT(attempts.id)::int AS "answeredCount",
        COALESCE(SUM(attempts.response_time_ms), 0)::int AS "responseTimeMs"
      FROM calendar_days
      LEFT JOIN student_question_attempts AS attempts
        ON attempts.student_id = ${studentId}::uuid
        AND attempts.answered_at >= (calendar_days.day::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND attempts.answered_at < ((calendar_days.day + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo')
      GROUP BY calendar_days.day
      ORDER BY calendar_days.day ASC
    `;
  }
}
