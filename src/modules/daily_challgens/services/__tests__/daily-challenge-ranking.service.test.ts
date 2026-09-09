import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyChallengeService } from '../daily-challenge.service.js';

test('ranking returns all participant metrics and the authenticated student position', async () => {
  const service = new DailyChallengeService({
    findStudentByUserId: async () => ({ id: 'student-2', fullName: 'Aluno Dois', email: 'dois@example.com' }),
    findActiveEnrollment: async () => ({ id: 'enrollment-1' }),
  } as never, {
    getRanking: async () => ({
      ranking: [
        { rank: 1, studentId: 'student-1', fullName: 'Aluno Um', score: 300, correctAnswers: 3, totalAnswered: 4, accuracy: 75, streakDays: 2 },
        { rank: 2, studentId: 'student-2', fullName: 'Aluno Dois', score: 200, correctAnswers: 2, totalAnswered: 3, accuracy: 67, streakDays: 1 },
      ],
      currentStudent: { rank: 2, studentId: 'student-2', fullName: 'Aluno Dois', score: 200, correctAnswers: 2, totalAnswered: 3, accuracy: 67, streakDays: 1 },
    }),
  } as never);

  const result = await service.getRanking('user-2', 'monitor-1', new Date('2026-09-01T03:00:00Z'), new Date('2026-10-01T03:00:00Z'));

  assert.equal(result.currentStudent.rank, 2);
  assert.equal(result.currentStudent.totalAnswered, 3);
  assert.equal(result.currentStudent.accuracy, 67);
  assert.equal(result.ranking[0]?.correctAnswers, 3);
});

test('ranking denies students without active access to the monitor', async () => {
  const service = new DailyChallengeService({
    findStudentByUserId: async () => ({ id: 'student-2', fullName: 'Aluno Dois', email: 'dois@example.com' }),
    findActiveEnrollment: async () => null,
  } as never, {} as never);

  await assert.rejects(
    () => service.getRanking('user-2', 'monitor-private', new Date('2026-09-01T03:00:00Z'), new Date('2026-10-01T03:00:00Z')),
    /ENROLLMENT_REQUIRED/,
  );
});

test('ranking keeps the authenticated student position when it is outside the returned top page', async () => {
  const service = new DailyChallengeService({
    findStudentByUserId: async () => ({ id: 'student-9', fullName: 'Aluno Nove', email: 'nove@example.com' }),
    findActiveEnrollment: async () => ({ id: 'enrollment-1' }),
  } as never, {
    getRanking: async () => ({
      ranking: [{ rank: 1, studentId: 'student-1', fullName: 'Aluno Um', score: 900, correctAnswers: 9, totalAnswered: 9, accuracy: 100, streakDays: 9 }],
      currentStudent: { rank: 9, studentId: 'student-9', fullName: 'Aluno Nove', score: 100, correctAnswers: 1, totalAnswered: 4, accuracy: 25, streakDays: 1 },
    }),
  } as never);

  const result = await service.getRanking('user-9', 'monitor-1', new Date('2026-09-01T03:00:00Z'), new Date('2026-10-01T03:00:00Z'));

  assert.equal(result.ranking.length, 1);
  assert.equal(result.currentStudent.rank, 9);
  assert.equal(result.currentStudent.studentId, 'student-9');
});
