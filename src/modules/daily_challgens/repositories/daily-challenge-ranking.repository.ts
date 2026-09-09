import { prisma } from '../../../lib/prisma.js';

export type DailyChallengeRankingAttempt = {
  studentId: string;
  isCorrect: boolean;
  answeredAt: Date;
  student: { fullName: string | null; email: string | null; avatarUrl: string | null };
};

export function buildDailyChallengeRanking(attempts: DailyChallengeRankingAttempt[], currentStudentId: string) {
  type Aggregate = {
    studentId: string;
    fullName: string | null;
    email: string | null;
    avatarUrl: string | null;
    totalAnswered: number;
    correctAnswers: number;
    correctDates: Set<string>;
  };

  const saoPauloDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const aggregates = new Map<string, Aggregate>();
  for (const attempt of attempts) {
    const aggregate = aggregates.get(attempt.studentId) ?? {
      studentId: attempt.studentId,
      fullName: attempt.student.fullName,
      email: attempt.student.email,
      avatarUrl: attempt.student.avatarUrl,
      totalAnswered: 0,
      correctAnswers: 0,
      correctDates: new Set<string>(),
    };
    aggregate.totalAnswered += 1;
    if (attempt.isCorrect) {
      aggregate.correctAnswers += 1;
      aggregate.correctDates.add(saoPauloDateKey(attempt.answeredAt));
    }
    aggregates.set(attempt.studentId, aggregate);
  }

  const calculateStreak = (dates: Set<string>) => {
    const sortedDates = [...dates].sort();
    let longest = 0;
    let current = 0;
    let previous: Date | null = null;
    for (const value of sortedDates) {
      const date = new Date(`${value}T00:00:00.000Z`);
      const isConsecutive = previous !== null && date.getTime() - previous.getTime() === 86_400_000;
      current = isConsecutive ? current + 1 : 1;
      longest = Math.max(longest, current);
      previous = date;
    }
    return longest;
  };

  const toParticipant = (aggregate: Aggregate, rank: number) => ({
    rank,
    studentId: aggregate.studentId,
    fullName: aggregate.fullName,
    email: aggregate.email,
    avatarUrl: aggregate.avatarUrl,
    score: aggregate.correctAnswers * 100,
    correctAnswers: aggregate.correctAnswers,
    totalAnswered: aggregate.totalAnswered,
    accuracy: aggregate.totalAnswered === 0 ? 0 : Math.round((aggregate.correctAnswers / aggregate.totalAnswered) * 100),
    streakDays: calculateStreak(aggregate.correctDates),
  });

  const accuracyOf = (aggregate: Aggregate) => aggregate.totalAnswered === 0 ? 0 : (aggregate.correctAnswers / aggregate.totalAnswered) * 100;
  const sorted = [...aggregates.values()].sort((left, right) =>
    right.correctAnswers - left.correctAnswers
    || accuracyOf(right) - accuracyOf(left)
    || left.studentId.localeCompare(right.studentId));
  const ranking = sorted.map((aggregate, index) => toParticipant(aggregate, index + 1));
  const currentAggregate = aggregates.get(currentStudentId);
  const currentStudent = currentAggregate
    ? toParticipant(currentAggregate, ranking.find((item) => item.studentId === currentStudentId)?.rank ?? 0)
    : {
        rank: 0,
        studentId: currentStudentId,
        fullName: null,
        email: null,
        avatarUrl: null,
        score: 0,
        correctAnswers: 0,
        totalAnswered: 0,
        accuracy: 0,
        streakDays: 0,
      };

  return { ranking, currentStudent };
}

export class DailyChallengeRankingRepository {
  async getRanking(monitorId: string, start: Date, end: Date, currentStudentId: string) {
    const attempts = await prisma.dailyChallengeAttempt.findMany({
      where: { answeredAt: { gte: start, lt: end }, dailyChallenge: { monitorId } },
      select: {
        studentId: true,
        isCorrect: true,
        answeredAt: true,
        student: { select: { fullName: true, email: true, avatarUrl: true } },
      },
      orderBy: [{ answeredAt: 'asc' }, { studentId: 'asc' }],
    });
    return buildDailyChallengeRanking(attempts, currentStudentId);
  }
}
