import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPerformanceResponse,
  buildFlashcardsPerformanceResponse,
  type StudentPerformanceRow,
  type StudentFlashcardPerformanceRow,
} from '../student-performance.service.js';
import { StudentPerformanceService } from '../student-performance.service.js';

test('agrupa o desempenho mantendo monitores, matérias e tópicos separados', () => {
  const rows: StudentPerformanceRow[] = [
    {
      monitorId: 'monitor-mat', monitorName: 'Monitor Exatas',
      subjectId: 'subject-math', subjectName: 'Matemática',
      topicId: 'topic-ratio', topicName: 'Razão e proporção',
      answeredCount: 4, correctCount: 3, lastAnsweredAt: '2026-09-04T10:00:00.000Z',
    },
    {
      monitorId: 'monitor-mat', monitorName: 'Monitor Exatas',
      subjectId: 'subject-physics', subjectName: 'Física',
      topicId: 'topic-kinematics', topicName: 'Cinemática',
      answeredCount: 2, correctCount: 1, lastAnsweredAt: '2026-09-03T10:00:00.000Z',
    },
    {
      monitorId: 'monitor-humanas', monitorName: 'Monitor Humanas',
      subjectId: 'subject-history', subjectName: 'História',
      topicId: 'topic-brazil', topicName: 'Brasil República',
      answeredCount: 3, correctCount: 3, lastAnsweredAt: '2026-09-02T10:00:00.000Z',
    },
  ];

  const result = buildPerformanceResponse(rows);

  assert.deepEqual(result.summary, {
    answeredCount: 9,
    correctCount: 7,
    incorrectCount: 2,
    accuracy: 78,
  });
  assert.equal(result.monitors.length, 2);
  assert.equal(result.monitors[0]?.subjects.length, 2);
  assert.equal(result.monitors[0]?.subjects[0]?.topics.length, 1);
  assert.equal(result.monitors[1]?.subjects[0]?.name, 'História');
  assert.equal(result.weakTopics[0]?.name, 'Cinemática');
});

test('agrupa o desempenho em flashcards por retenção e ratings', () => {
  const flashcardRows: StudentFlashcardPerformanceRow[] = [
    {
      monitorId: 'm1', monitorName: 'Medicina',
      subjectId: 's1', subjectName: 'Anatomia',
      topicId: 't1', topicName: 'Sistema Osseo',
      reviewedCount: 10, retainedCount: 8,
      againCount: 1, hardCount: 1, goodCount: 5, easyCount: 3,
      lastReviewedAt: '2026-09-07T10:00:00.000Z',
    },
  ];

  const result = buildFlashcardsPerformanceResponse(flashcardRows, { dueCount: 3, totalCardsCount: 25 });

  assert.deepEqual(result.summary, {
    reviewedCount: 10,
    retainedCount: 8,
    againCount: 1,
    hardCount: 1,
    goodCount: 5,
    easyCount: 3,
    retentionRate: 80,
    dueCount: 3,
    totalCardsCount: 25,
  });
  assert.equal(result.monitors.length, 1);
  assert.equal(result.monitors[0]?.name, 'Medicina');
  assert.equal(result.monitors[0]?.retentionRate, 80);
});

test('consulta questões, simulados e desafios diários separadamente', async () => {
  const modes: string[] = [];
  const row = (mode: string): StudentPerformanceRow[] => mode === 'PRACTICE' ? [{
    monitorId: 'm1', monitorName: 'Monitor', subjectId: 's1', subjectName: 'Matéria', topicId: null, topicName: null,
    answeredCount: 2, correctCount: 1, lastAnsweredAt: null,
  }] : [];
  const service = new StudentPerformanceService({
    findStudentByUserId: async () => ({ id: 'student-1' }),
    aggregateByScope: async (_studentId: string, _monitorIds: string[], mode: string) => { modes.push(mode); return row(mode); },
    aggregateWeeklySimulationByScope: async () => [],
    aggregateFlashcardByScope: async () => [],
    getFlashcardOverview: async () => ({ dueCount: 0, totalCardsCount: 0 }),
  } as never, { findAccessibleMonitorIds: async () => ['m1'] } as never);

  const result = await service.getForUser('user-1');

  assert.deepEqual(modes.sort(), ['DAILY_CHALLENGE', 'PRACTICE', 'SIMULATED']);
  assert.equal(result.summary.answeredCount, 2);
  assert.equal(result.simulados.summary.answeredCount, 0);
  assert.equal(result.dailyChallenges.summary.answeredCount, 0);
});

test('inclui respostas dos simulados semanais no desempenho de simulados', async () => {
  const service = new StudentPerformanceService({
    findStudentByUserId: async () => ({ id: 'student-1' }),
    aggregateByScope: async () => [],
    aggregateWeeklySimulationByScope: async () => [{
      monitorId: 'm1', monitorName: 'Monitor', subjectId: 's1', subjectName: 'Matéria',
      topicId: 't1', topicName: 'Tópico', answeredCount: 3, correctCount: 1,
      lastAnsweredAt: '2026-09-09T20:00:00.000Z',
    }],
    aggregateFlashcardByScope: async () => [],
    getFlashcardOverview: async () => ({ dueCount: 0, totalCardsCount: 0 }),
  } as never, { findAccessibleMonitorIds: async () => ['m1'] } as never);

  const result = await service.getForUser('user-1');

  assert.deepEqual(result.simulados.summary, {
    answeredCount: 3, correctCount: 1, incorrectCount: 2, accuracy: 33,
  });
  assert.equal(result.simulados.monitors[0]?.subjects[0]?.topics[0]?.name, 'Tópico');
});
