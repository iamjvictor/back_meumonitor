import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyChallengeRanking } from '../daily-challenge-ranking.repository.js';

test('ranking aggregates answered total, accuracy, score, streak and position from real attempts', () => {
  const student = (fullName: string, email: string) => ({ fullName, email, avatarUrl: null });
  const result = buildDailyChallengeRanking([
    { studentId: 'student-1', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Primeiro', 'one@example.com') },
    { studentId: 'student-1', isCorrect: false, answeredAt: new Date('2026-09-02T12:00:00Z'), student: student('Primeiro', 'one@example.com') },
    { studentId: 'student-1', isCorrect: true, answeredAt: new Date('2026-09-02T13:00:00Z'), student: student('Primeiro', 'one@example.com') },
    { studentId: 'student-2', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Segundo', 'two@example.com') },
  ], 'student-1');

  assert.equal(result.ranking[0]?.studentId, 'student-1');
  assert.deepEqual(result.ranking[0] && {
    rank: result.ranking[0].rank,
    correctAnswers: result.ranking[0].correctAnswers,
    totalAnswered: result.ranking[0].totalAnswered,
    accuracy: result.ranking[0].accuracy,
    score: result.ranking[0].score,
    streakDays: result.ranking[0].streakDays,
  }, { rank: 1, correctAnswers: 2, totalAnswered: 3, accuracy: 67, score: 200, streakDays: 2 });
  assert.equal(result.currentStudent?.rank, 1);
});
