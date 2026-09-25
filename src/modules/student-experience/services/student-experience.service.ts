import { StudentExperienceRepository, type ExperienceFilter } from '../repositories/student-experience.repository.js';

export type ExperienceCounts = {
  dailyChallengesAnswered: number;
  dailyChallengesCorrect: number;
  streakDays: number;
  practiceAnswered: number;
  practiceCorrect: number;
  simulatedAnswered: number;
  simulatedCorrect: number;
  flashcardsReviewed: number;
  flashcardsRetained: number;
};

export type ExperienceBreakdown = {
  dailyChallengeXp: number;
  streakBonusXp: number;
  practiceXp: number;
  simulatedXp: number;
  flashcardXp: number;
};

export type ExperienceResult = {
  totalXp: number;
  level: number;
  currentLevelProgress: number;
  nextLevelXp: number;
  totalQuestionsAnswered: number;
  totalQuestionsCorrect: number;
  overallAccuracy: number;
  counts: ExperienceCounts;
  breakdown: ExperienceBreakdown;
};

const TIME_ZONE = 'America/Sao_Paulo';

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function calculateStreakStats(dateKeys: Set<string>): {
  currentStreak: number;
  longestStreak: number;
  bonusDays: number;
  bonusXp: number;
} {
  if (dateKeys.size === 0) {
    return { currentStreak: 0, longestStreak: 0, bonusDays: 0, bonusXp: 0 };
  }

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
}

export function calculateConsecutiveStreak(dateKeys: Set<string>): number {
  return calculateStreakStats(dateKeys).longestStreak;
}

export function computeExperienceFromData(
  questionAttempts: Array<{ mode: string; isCorrect: boolean; answeredAt: Date }>,
  flashcardLogs: Array<{ rating: string; reviewedAt: Date }>
): ExperienceResult {
  let dailyChallengesAnswered = 0;
  let dailyChallengesCorrect = 0;
  let practiceAnswered = 0;
  let practiceCorrect = 0;
  let simulatedAnswered = 0;
  let simulatedCorrect = 0;
  const activeDates = new Set<string>();
  const dailyChallengeCorrectDates = new Set<string>();

  for (const attempt of questionAttempts) {
    if (attempt.mode === 'DAILY_CHALLENGE') {
      dailyChallengesAnswered += 1;
      if (attempt.isCorrect) {
        dailyChallengesCorrect += 1;
        const key = formatDateKey(attempt.answeredAt);
        activeDates.add(key);
        dailyChallengeCorrectDates.add(key);
      }
    } else if (attempt.mode === 'SIMULATED') {
      simulatedAnswered += 1;
      if (attempt.isCorrect) {
        simulatedCorrect += 1;
      }
      activeDates.add(formatDateKey(attempt.answeredAt));
    } else {
      // PRACTICE mode (default)
      practiceAnswered += 1;
      if (attempt.isCorrect) {
        practiceCorrect += 1;
      }
      activeDates.add(formatDateKey(attempt.answeredAt));
    }
  }

  let flashcardsReviewed = 0;
  let flashcardsRetained = 0;

  for (const log of flashcardLogs) {
    flashcardsReviewed += 1;
    if (log.rating === 'GOOD' || log.rating === 'EASY') {
      flashcardsRetained += 1;
    }
    activeDates.add(formatDateKey(log.reviewedAt));
  }

  const dailyChallengeStreakStats = calculateStreakStats(dailyChallengeCorrectDates);
  const dailyChallengeStreakDays = dailyChallengeStreakStats.longestStreak;
  const dailyChallengeStreakBonusXp = dailyChallengeStreakStats.bonusXp;

  // XP Rules:
  // - Daily Challenge: 100 XP base per correct answer + 20 XP bonus per consecutive correct day (day 2 onwards)
  // - Practice attempted: +5 XP per question completed
  // - Practice correct bonus: +10 XP per correct question (+15 XP total when correct)
  // - Simulated attempted: +5 XP per question completed
  // - Simulated correct bonus: +10 XP per correct question (+15 XP total when correct)
  // - Flashcard reviewed: +5 XP per card reviewed
  const dailyChallengeBaseXp = dailyChallengesCorrect * 100;
  const dailyChallengeXp = dailyChallengeBaseXp + dailyChallengeStreakBonusXp;
  const practiceXp = (practiceAnswered * 5) + (practiceCorrect * 10);
  const simulatedXp = (simulatedAnswered * 5) + (simulatedCorrect * 10);
  const flashcardXp = flashcardsReviewed * 5;

  const totalXp = dailyChallengeXp + practiceXp + simulatedXp + flashcardXp;
  const totalQuestionsAnswered = dailyChallengesAnswered + practiceAnswered + simulatedAnswered;
  const totalQuestionsCorrect = dailyChallengesCorrect + practiceCorrect + simulatedCorrect;
  const overallAccuracy = totalQuestionsAnswered > 0
    ? Math.round((totalQuestionsCorrect / totalQuestionsAnswered) * 100)
    : 0;

  const xpPerLevel = 500;
  const level = Math.floor(totalXp / xpPerLevel) + 1;
  const currentLevelProgress = totalXp % xpPerLevel;

  return {
    totalXp,
    level,
    currentLevelProgress,
    nextLevelXp: xpPerLevel,
    totalQuestionsAnswered,
    totalQuestionsCorrect,
    overallAccuracy,
    counts: {
      dailyChallengesAnswered,
      dailyChallengesCorrect,
      streakDays: dailyChallengeStreakDays,
      practiceAnswered,
      practiceCorrect,
      simulatedAnswered,
      simulatedCorrect,
      flashcardsReviewed,
      flashcardsRetained,
    },
    breakdown: {
      dailyChallengeXp,
      streakBonusXp: dailyChallengeStreakBonusXp,
      practiceXp,
      simulatedXp,
      flashcardXp,
    },
  };
}

export class StudentExperienceService {
  constructor(private readonly repository = new StudentExperienceRepository()) {}

  async getExperience(userId: string, filterInput: { monitorId?: string; period?: 'week' | 'month' | 'all'; month?: string } = {}): Promise<ExperienceResult> {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (filterInput.period === 'week') {
      const now = new Date();
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = undefined;
    } else if (filterInput.period === 'all') {
      startDate = undefined;
      endDate = undefined;
    } else {
      const month = filterInput.month ?? new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' }).format(new Date());
      if (/^\d{4}-\d{2}$/.test(month)) {
        const [year, numericMonth] = month.split('-').map(Number);
        if (year && numericMonth && numericMonth >= 1 && numericMonth <= 12) {
          startDate = new Date(Date.UTC(year, numericMonth - 1, 1, 3, 0, 0, 0));
          endDate = new Date(Date.UTC(year, numericMonth, 1, 3, 0, 0, 0));
        }
      }
    }

    const filter: ExperienceFilter = {
      studentId: student.id,
      monitorId: filterInput.monitorId,
      startDate,
      endDate,
    };

    const [questionAttempts, flashcardLogs] = await Promise.all([
      this.repository.getQuestionAttempts(filter),
      this.repository.getFlashcardReviewLogs(filter),
    ]);

    return computeExperienceFromData(questionAttempts, flashcardLogs);
  }
}
