import { prisma } from '../../../lib/prisma.js';

export class DailyChallengeRankingRepository {
  async get(monitorId: string, start: Date, end: Date) {
    const rows = await prisma.dailyChallengeAttempt.groupBy({
      by: ['studentId'],
      where: { isCorrect: true, answeredAt: { gte: start, lt: end }, dailyChallenge: { monitorId } },
      _count: { _all: true },
      orderBy: { _count: { studentId: 'desc' } },
    });
    const students = await prisma.student.findMany({ where: { id: { in: rows.map((row) => row.studentId) } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(students.map((student) => [student.id, student]));
    return rows.map((row, index) => ({ rank: index + 1, studentId: row.studentId, fullName: byId.get(row.studentId)?.fullName ?? null, score: row._count._all, correctAnswers: row._count._all }));
  }
}
