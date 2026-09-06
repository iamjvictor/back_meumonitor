import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPerformanceResponse, type StudentPerformanceRow } from '../student-performance.service.js';

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
