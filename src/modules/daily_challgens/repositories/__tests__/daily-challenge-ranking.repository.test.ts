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
  }, { rank: 1, correctAnswers: 2, totalAnswered: 3, accuracy: 67, score: 220, streakDays: 2 });
  assert.equal(result.currentStudent?.rank, 1);
});

test('ranking includes general XP from questions and flashcards', () => {
  const student = (fullName: string, email: string) => ({ fullName, email, avatarUrl: null });
  const result = buildDailyChallengeRanking(
    [
      { studentId: 'student-1', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Primeiro', 'one@example.com') },
    ],
    'student-1',
    [
      // 2 practice questions: 1 correct (2*5 + 1*10 = 20 XP)
      { studentId: 'student-1', mode: 'PRACTICE', isCorrect: true, answeredAt: new Date('2026-09-01T13:00:00Z'), student: student('Primeiro', 'one@example.com') },
      { studentId: 'student-1', mode: 'PRACTICE', isCorrect: false, answeredAt: new Date('2026-09-01T14:00:00Z'), student: student('Primeiro', 'one@example.com') },
    ],
    [
      // 1 flashcard reviewed (5 XP)
      { studentId: 'student-1', rating: 'GOOD', reviewedAt: new Date('2026-09-01T15:00:00Z'), student: student('Primeiro', 'one@example.com') },
    ]
  );

  // Score = 100 (daily challenge) + 20 (practice) + 5 (flashcard) = 125 XP
  assert.equal(result.ranking[0]?.score, 125);
  assert.equal(result.currentStudent?.score, 125);
});

test('ranking passes totalChallenges to participants and result object', () => {
  const student = (fullName: string, email: string) => ({ fullName, email, avatarUrl: null });
  const result = buildDailyChallengeRanking(
    [
      { studentId: 'student-1', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Primeiro', 'one@example.com') },
    ],
    'student-1',
    [],
    [],
    7
  );

  assert.equal(result.totalChallenges, 7);
  assert.equal(result.ranking[0]?.totalChallenges, 7);
  assert.equal(result.currentStudent?.totalChallenges, 7);
});

test('ranking orders by acertos, then precisao, then XP', () => {
  const student = (fullName: string, email: string) => ({ fullName, email, avatarUrl: null });
  // Student A: 2 acertos, 2 total (100% precisao), 200 XP
  // Student B: 2 acertos, 4 total (50% precisao), 500 XP (more XP via practice)
  // Student C: 3 acertos, 6 total (50% precisao), 300 XP
  const result = buildDailyChallengeRanking(
    [
      { studentId: 'student-A', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Aluno A', 'a@example.com') },
      { studentId: 'student-A', isCorrect: true, answeredAt: new Date('2026-09-02T12:00:00Z'), student: student('Aluno A', 'a@example.com') },

      { studentId: 'student-B', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Aluno B', 'b@example.com') },
      { studentId: 'student-B', isCorrect: true, answeredAt: new Date('2026-09-02T12:00:00Z'), student: student('Aluno B', 'b@example.com') },
      { studentId: 'student-B', isCorrect: false, answeredAt: new Date('2026-09-03T12:00:00Z'), student: student('Aluno B', 'b@example.com') },
      { studentId: 'student-B', isCorrect: false, answeredAt: new Date('2026-09-04T12:00:00Z'), student: student('Aluno B', 'b@example.com') },

      { studentId: 'student-C', isCorrect: true, answeredAt: new Date('2026-09-01T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
      { studentId: 'student-C', isCorrect: true, answeredAt: new Date('2026-09-02T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
      { studentId: 'student-C', isCorrect: true, answeredAt: new Date('2026-09-03T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
      { studentId: 'student-C', isCorrect: false, answeredAt: new Date('2026-09-04T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
      { studentId: 'student-C', isCorrect: false, answeredAt: new Date('2026-09-05T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
      { studentId: 'student-C', isCorrect: false, answeredAt: new Date('2026-09-06T12:00:00Z'), student: student('Aluno C', 'c@example.com') },
    ],
    'student-A',
    [
      // Extra XP for Student B: 30 practice questions (30*5 = 150 XP)
      ...Array.from({ length: 30 }, (_, i) => ({
        studentId: 'student-B',
        mode: 'PRACTICE',
        isCorrect: false,
        answeredAt: new Date('2026-09-01T15:00:00Z'),
        student: student('Aluno B', 'b@example.com'),
      })),
    ]
  );

  // 1º should be Student C (3 acertos)
  assert.equal(result.ranking[0]?.studentId, 'student-C');
  // 2º should be Student A (2 acertos, 100% precisao vs Student B with 2 acertos, 50% precisao)
  assert.equal(result.ranking[1]?.studentId, 'student-A');
  // 3º should be Student B (2 acertos, 50% precisao)
  assert.equal(result.ranking[2]?.studentId, 'student-B');
});
