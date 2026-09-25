import assert from 'node:assert/strict';
import test from 'node:test';
import { computeExperienceFromData, calculateConsecutiveStreak } from '../student-experience.service.js';

test('calculateConsecutiveStreak calculates daily streaks correctly', () => {
  const dates = new Set(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-06']);
  const streak = calculateConsecutiveStreak(dates);
  assert.equal(streak, 3);
});

test('calculateConsecutiveStreak returns 0 for empty dates', () => {
  const streak = calculateConsecutiveStreak(new Set());
  assert.equal(streak, 0);
});

test('computeExperienceFromData computes real XP points and counts across all activities', () => {
  const questionAttempts = [
    // 2 Daily Challenges both correct on consecutive days (Day 1: 100 XP, Day 2: 120 XP -> 220 XP)
    { mode: 'DAILY_CHALLENGE', isCorrect: true, answeredAt: new Date('2026-09-01T10:00:00Z') },
    { mode: 'DAILY_CHALLENGE', isCorrect: true, answeredAt: new Date('2026-09-02T10:00:00Z') },
    // 3 Practice Questions (2 correct -> 3*5 + 2*10 = 35 XP)
    { mode: 'PRACTICE', isCorrect: true, answeredAt: new Date('2026-09-01T11:00:00Z') },
    { mode: 'PRACTICE', isCorrect: true, answeredAt: new Date('2026-09-02T11:00:00Z') },
    { mode: 'PRACTICE', isCorrect: false, answeredAt: new Date('2026-09-02T12:00:00Z') },
    // 1 Simulated (1 correct -> 1*5 + 1*10 = 15 XP)
    { mode: 'SIMULATED', isCorrect: true, answeredAt: new Date('2026-09-03T11:00:00Z') },
  ];

  const flashcardLogs = [
    // 2 Flashcards reviewed (2 * 5 = 10 XP)
    { rating: 'GOOD', reviewedAt: new Date('2026-09-01T15:00:00Z') },
    { rating: 'AGAIN', reviewedAt: new Date('2026-09-02T15:00:00Z') },
  ];

  const result = computeExperienceFromData(questionAttempts, flashcardLogs);

  // Counts verification
  assert.equal(result.counts.dailyChallengesAnswered, 2);
  assert.equal(result.counts.dailyChallengesCorrect, 2);
  assert.equal(result.counts.practiceAnswered, 3);
  assert.equal(result.counts.practiceCorrect, 2);
  assert.equal(result.counts.simulatedAnswered, 1);
  assert.equal(result.counts.simulatedCorrect, 1);
  assert.equal(result.counts.flashcardsReviewed, 2);
  assert.equal(result.counts.flashcardsRetained, 1);

  // Daily Challenge Streak: 2 consecutive days (2026-09-01 and 2026-09-02)
  assert.equal(result.counts.streakDays, 2);

  // Breakdown verification:
  // - dailyChallengeXp: (2 * 100) + (1 * 20) = 220 XP (100 no 1º dia, 120 no 2º dia)
  // - streakBonusXp: 1 * 20 = 20
  // - practiceXp: (3 answered * 5 = 15) + (2 correct * 10 = 20) = 35
  // - simulatedXp: (1 answered * 5 = 5) + (1 correct * 10 = 10) = 15
  // - flashcardXp: 2 reviewed * 5 = 10
  assert.equal(result.breakdown.dailyChallengeXp, 220);
  assert.equal(result.breakdown.streakBonusXp, 20);
  assert.equal(result.breakdown.practiceXp, 35);
  assert.equal(result.breakdown.simulatedXp, 15);
  assert.equal(result.breakdown.flashcardXp, 10);

  // Total XP = 220 + 35 + 15 + 10 = 280 XP
  assert.equal(result.totalXp, 280);
  assert.equal(result.totalQuestionsAnswered, 6);
  assert.equal(result.totalQuestionsCorrect, 5);
  assert.equal(result.overallAccuracy, 83); // Math.round(5/6 * 100) = 83
  assert.equal(result.level, 1);
  assert.equal(result.currentLevelProgress, 280);
});
