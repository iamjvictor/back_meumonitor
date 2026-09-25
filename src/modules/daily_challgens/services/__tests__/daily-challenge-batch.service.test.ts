import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyChallengeService } from '../daily-challenge.service.js';

test('returns every unanswered challenge from the student active enrollments', async () => {
  const repository = {
    findStudentByUserId: async () => ({ id: 'student-1', fullName: 'Aluno', email: 'a@a.com' }),
    findActiveEnrollmentMonitorIds: async () => ['monitor-1', 'monitor-2', 'monitor-3'],
    findCurrentForStudentMonitors: async () => [
      { id: 'challenge-1', monitorId: 'monitor-1', availableFrom: new Date('2026-09-03T03:00:00Z'), availableUntil: new Date('2026-09-04T02:59:59Z'), question: { id: 'q1', text: 'Q1', alternatives: [], kind: 'MULTIPLE_CHOICE', difficulty: null, subject: null, topic: null }, attempts: [] },
      { id: 'challenge-2', monitorId: 'monitor-2', availableFrom: new Date('2026-09-03T03:00:00Z'), availableUntil: new Date('2026-09-04T02:59:59Z'), question: { id: 'q2', text: 'Q2', alternatives: [], kind: 'MULTIPLE_CHOICE', difficulty: null, subject: null, topic: null }, attempts: [] },
    ],
  };
  const result = await new DailyChallengeService(repository as never).getCurrentForStudent('user-1', new Date('2026-09-03T12:00:00.000Z'));
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((challenge) => challenge.monitorId), ['monitor-1', 'monitor-2']);
});

test('returns the real dashboard challenge summary for active enrollments', async () => {
  let received: Record<string, unknown> | undefined;
  const repository = {
    findStudentByUserId: async () => ({ id: 'student-1', fullName: 'Aluno', email: 'a@a.com' }),
    findActiveEnrollmentMonitorIds: async () => ['monitor-1', 'monitor-2'],
  };
  const rankingRepository = {
    getDashboardSummary: async (input: Record<string, unknown>) => {
      received = input;
      return {
        currentStudent: { rank: 3, score: 1450, correctAnswers: 3, streakDays: 3 },
        challengeDays: [{ day: '2026-09-09', weekday: 'Q', completed: true, correct: true }],
      };
    },
  };

  const result = await new DailyChallengeService(repository as never, rankingRepository as never)
    .getDashboardSummary('user-1', new Date('2026-09-09T12:00:00.000Z'));

  assert.equal(result.currentStudent.rank, 3);
  assert.equal(result.currentStudent.score, 1450);
  assert.deepEqual(result.challengeDays, [{ day: '2026-09-09', weekday: 'Q', completed: true, correct: true }]);
  assert.deepEqual(received?.monitorIds, ['monitor-1', 'monitor-2']);
});
