import { prisma } from '../../../lib/prisma.js';

export type DailyChallengeRankingAttempt = {
  studentId: string;
  isCorrect: boolean;
  answeredAt: Date;
  student: { fullName: string | null; email: string | null; avatarUrl: string | null };
};

export type DailyChallengeDaySummary = {
  day: string;
  weekday: string;
  completed: boolean;
  correct: boolean;
};

function buildChallengeDays(attempts: DailyChallengeRankingAttempt[], dayKeys: string[]): DailyChallengeDaySummary[] {
  const attemptsByDay = new Map<string, DailyChallengeRankingAttempt[]>();
  const saoPauloDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);

  for (const attempt of attempts) {
    const key = saoPauloDateKey(attempt.answeredAt);
    const current = attemptsByDay.get(key) ?? [];
    current.push(attempt);
    attemptsByDay.set(key, current);
  }

  return dayKeys.map((day) => {
    const dayAttempts = attemptsByDay.get(day) ?? [];
    const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short' })
      .format(new Date(`${day}T12:00:00-03:00`)).replace('.', '').slice(0, 1).toUpperCase();
    return {
      day,
      weekday,
      completed: dayAttempts.length > 0,
      correct: dayAttempts.some((attempt) => attempt.isCorrect),
    };
  });
}

export type StudentActivityItem = {
  studentId: string;
  student: { fullName: string | null; email: string | null; avatarUrl: string | null };
};

export type QuestionAttemptRankingItem = StudentActivityItem & {
  mode: string;
  isCorrect: boolean;
  answeredAt: Date;
};

export type FlashcardLogRankingItem = StudentActivityItem & {
  rating: string;
  reviewedAt: Date;
};

export function buildDailyChallengeRanking(
  attempts: DailyChallengeRankingAttempt[],
  currentStudentId: string,
  questionAttempts: QuestionAttemptRankingItem[] = [],
  flashcardLogs: FlashcardLogRankingItem[] = [],
  totalChallenges = 0
) {
  type Aggregate = {
    studentId: string;
    fullName: string | null;
    email: string | null;
    avatarUrl: string | null;
    dailyChallengesTotal: number;
    dailyChallengesCorrect: number;
    dailyChallengeCorrectDates: Set<string>;
    practiceAnswered: number;
    practiceCorrect: number;
    simulatedAnswered: number;
    simulatedCorrect: number;
    flashcardsReviewed: number;
  };

  const saoPauloDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const aggregates = new Map<string, Aggregate>();

  const getOrCreate = (studentId: string, student: { fullName: string | null; email: string | null; avatarUrl: string | null }) => {
    let aggregate = aggregates.get(studentId);
    if (!aggregate) {
      aggregate = {
        studentId,
        fullName: student.fullName,
        email: student.email,
        avatarUrl: student.avatarUrl,
        dailyChallengesTotal: 0,
        dailyChallengesCorrect: 0,
        dailyChallengeCorrectDates: new Set<string>(),
        practiceAnswered: 0,
        practiceCorrect: 0,
        simulatedAnswered: 0,
        simulatedCorrect: 0,
        flashcardsReviewed: 0,
      };
      aggregates.set(studentId, aggregate);
    }
    return aggregate;
  };

  for (const attempt of attempts) {
    const aggregate = getOrCreate(attempt.studentId, attempt.student);
    aggregate.dailyChallengesTotal += 1;
    if (attempt.isCorrect) {
      aggregate.dailyChallengesCorrect += 1;
      aggregate.dailyChallengeCorrectDates.add(saoPauloDateKey(attempt.answeredAt));
    }
  }

  for (const item of questionAttempts) {
    const aggregate = getOrCreate(item.studentId, item.student);
    if (item.mode === 'SIMULATED') {
      aggregate.simulatedAnswered += 1;
      if (item.isCorrect) {
        aggregate.simulatedCorrect += 1;
      }
    } else {
      aggregate.practiceAnswered += 1;
      if (item.isCorrect) {
        aggregate.practiceCorrect += 1;
      }
    }
  }

  for (const item of flashcardLogs) {
    const aggregate = getOrCreate(item.studentId, item.student);
    aggregate.flashcardsReviewed += 1;
  }

  const calculateStreakStats = (dateKeys: Set<string>) => {
    if (dateKeys.size === 0) return { currentStreak: 0, longestStreak: 0, bonusDays: 0, bonusXp: 0 };
    const sortedDates = [...dateKeys].sort();
    let longest = 0;
    let current = 0;
    let totalBonusDays = 0;
    let previous: Date | null = null;
    for (const value of sortedDates) {
      const date = new Date(`${value}T00:00:00.000Z`);
      const isConsecutive = previous !== null && date.getTime() - previous.getTime() === 86_400_000;
      if (isConsecutive) {
        current += 1;
        totalBonusDays += 1;
      } else {
        current = 1;
      }
      longest = Math.max(longest, current);
      previous = date;
    }
    return {
      currentStreak: current,
      longestStreak: longest,
      bonusDays: totalBonusDays,
      bonusXp: totalBonusDays * 20,
    };
  };

  const scoreOf = (aggregate: Aggregate) => {
    const dailyChallengeStreak = calculateStreakStats(aggregate.dailyChallengeCorrectDates);
    const dailyChallengeXp = (aggregate.dailyChallengesCorrect * 100) + dailyChallengeStreak.bonusXp;
    const practiceXp = (aggregate.practiceAnswered * 5) + (aggregate.practiceCorrect * 10);
    const simulatedXp = (aggregate.simulatedAnswered * 5) + (aggregate.simulatedCorrect * 10);
    const flashcardXp = aggregate.flashcardsReviewed * 5;
    return dailyChallengeXp + practiceXp + simulatedXp + flashcardXp;
  };

  const toParticipant = (aggregate: Aggregate, rank: number) => {
    const streakStats = calculateStreakStats(aggregate.dailyChallengeCorrectDates);
    const score = scoreOf(aggregate);
    return {
      rank,
      studentId: aggregate.studentId,
      fullName: aggregate.fullName,
      email: aggregate.email,
      avatarUrl: aggregate.avatarUrl,
      score,
      correctAnswers: aggregate.dailyChallengesCorrect,
      totalAnswered: aggregate.dailyChallengesTotal,
      accuracy: aggregate.dailyChallengesTotal === 0 ? 0 : Math.round((aggregate.dailyChallengesCorrect / aggregate.dailyChallengesTotal) * 100),
      streakDays: streakStats.longestStreak,
      totalChallenges,
    };
  };

  const accuracyOf = (aggregate: Aggregate) => aggregate.dailyChallengesTotal === 0 ? 0 : (aggregate.dailyChallengesCorrect / aggregate.dailyChallengesTotal) * 100;
  const sorted = [...aggregates.values()].sort((left, right) =>
    right.dailyChallengesCorrect - left.dailyChallengesCorrect
    || accuracyOf(right) - accuracyOf(left)
    || scoreOf(right) - scoreOf(left)
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
        totalChallenges,
      };

  return { ranking, currentStudent, totalChallenges };
}

export class DailyChallengeRankingRepository {
  async getRanking(monitorId: string, start?: Date, end?: Date, currentStudentId?: string, period?: 'week' | 'month' | 'all') {
    const hasDateFilter = Boolean(start || end);
    const dateClause = hasDateFilter ? {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: end } : {}),
    } : undefined;

    let totalChallengesPromise: Promise<number>;
    if (period === 'week') {
      totalChallengesPromise = Promise.resolve(7);
    } else if (period === 'all') {
      totalChallengesPromise = prisma.dailyChallenge.count({
        where: { monitorId },
      });
    } else {
      // period === 'month' or default
      totalChallengesPromise = prisma.dailyChallenge.count({
        where: {
          monitorId,
          ...(dateClause ? { challengeDate: dateClause } : {}),
        },
      });
    }

    const [attempts, questionAttempts, flashcardLogs, totalChallenges] = await Promise.all([
      prisma.dailyChallengeAttempt.findMany({
        where: {
          ...(dateClause ? { answeredAt: dateClause } : {}),
          dailyChallenge: { monitorId },
        },
        select: {
          studentId: true,
          isCorrect: true,
          answeredAt: true,
          student: { select: { fullName: true, email: true, avatarUrl: true } },
        },
        orderBy: [{ answeredAt: 'asc' }, { studentId: 'asc' }],
      }),
      prisma.studentQuestionAttempt.findMany({
        where: {
          ...(dateClause ? { answeredAt: dateClause } : {}),
          monitorId,
          mode: { in: ['PRACTICE', 'SIMULATED'] },
        },
        select: {
          studentId: true,
          mode: true,
          isCorrect: true,
          answeredAt: true,
          student: { select: { fullName: true, email: true, avatarUrl: true } },
        },
      }),
      prisma.studentFlashcardReviewLog.findMany({
        where: {
          ...(dateClause ? { reviewedAt: dateClause } : {}),
          flashcard: { monitorId },
        },
        select: {
          studentId: true,
          rating: true,
          reviewedAt: true,
          student: { select: { fullName: true, email: true, avatarUrl: true } },
        },
      }),
      totalChallengesPromise,
    ]);
    return buildDailyChallengeRanking(attempts, currentStudentId ?? '', questionAttempts, flashcardLogs, totalChallenges);
  }

  async getDashboardSummary(input: {
    monitorIds: string[];
    rankingStart: Date;
    rankingEnd: Date;
    daysStart: Date;
    daysEnd: Date;
    dayKeys: string[];
    currentStudentId: string;
  }) {
    if (input.monitorIds.length === 0) {
      return {
        currentStudent: { rank: 0, studentId: input.currentStudentId, fullName: null, email: null, avatarUrl: null, score: 0, correctAnswers: 0, totalAnswered: 0, accuracy: 0, streakDays: 0 },
        challengeDays: buildChallengeDays([], input.dayKeys),
      };
    }

    const select = {
      studentId: true,
      isCorrect: true,
      answeredAt: true,
      student: { select: { fullName: true, email: true, avatarUrl: true } },
    } as const;
    const [rankingAttempts, questionAttempts, flashcardLogs, recentAttempts] = await Promise.all([
      prisma.dailyChallengeAttempt.findMany({
        where: { answeredAt: { gte: input.rankingStart, lt: input.rankingEnd }, dailyChallenge: { monitorId: { in: input.monitorIds } } },
        select,
        orderBy: [{ answeredAt: 'asc' }, { studentId: 'asc' }],
      }),
      prisma.studentQuestionAttempt.findMany({
        where: {
          answeredAt: { gte: input.rankingStart, lt: input.rankingEnd },
          monitorId: { in: input.monitorIds },
          mode: { in: ['PRACTICE', 'SIMULATED'] },
        },
        select: {
          studentId: true,
          mode: true,
          isCorrect: true,
          answeredAt: true,
          student: { select: { fullName: true, email: true, avatarUrl: true } },
        },
      }),
      prisma.studentFlashcardReviewLog.findMany({
        where: { reviewedAt: { gte: input.rankingStart, lt: input.rankingEnd }, flashcard: { monitorId: { in: input.monitorIds } } },
        select: {
          studentId: true,
          rating: true,
          reviewedAt: true,
          student: { select: { fullName: true, email: true, avatarUrl: true } },
        },
      }),
      prisma.dailyChallengeAttempt.findMany({
        where: { answeredAt: { gte: input.daysStart, lt: input.daysEnd }, dailyChallenge: { monitorId: { in: input.monitorIds } } },
        select,
      }),
    ]);
    const ranking = buildDailyChallengeRanking(rankingAttempts, input.currentStudentId, questionAttempts, flashcardLogs);
    return { currentStudent: ranking.currentStudent, challengeDays: buildChallengeDays(recentAttempts, input.dayKeys) };
  }
}
