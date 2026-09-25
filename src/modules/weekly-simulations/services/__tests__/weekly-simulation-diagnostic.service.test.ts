import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklySimulationDiagnostic, WeeklySimulationDiagnosticService } from '../weekly-simulation-diagnostic.service.js';

test('cruza dificuldade de questões e flashcards pelo tópico usando os pesos definidos', () => {
  const result = buildWeeklySimulationDiagnostic({
    questions: [{ monitorId: 'm1', subjectId: 's1', topicId: 't1', topicName: 'Fraco', answeredCount: 8, correctCount: 2 }],
    flashcards: [{ monitorId: 'm1', subjectId: 's1', topicId: 't1', topicName: 'Fraco', reviewedCount: 10, againCount: 4, hardCount: 2, goodCount: 2, easyCount: 2 }],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.topicId, 't1');
  assert.equal(result[0]?.questionEvidenceCount, 8);
  assert.equal(result[0]?.flashcardEvidenceCount, 10);
  assert.ok((result[0]?.difficultyScore ?? 0) > 0.6);
  assert.ok((result[0]?.difficultyScore ?? 0) < 0.7);
});

test('usa a única fonte disponível e mantém tópico sem evidência neutro', () => {
  const result = buildWeeklySimulationDiagnostic({
    questions: [{ monitorId: 'm1', subjectId: 's1', topicId: 't1', topicName: 'Questões', answeredCount: 4, correctCount: 0 }],
    flashcards: [{ monitorId: 'm1', subjectId: 's1', topicId: 't2', topicName: 'Cards', reviewedCount: 4, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 4 }],
    availableTopics: [{ monitorId: 'm1', subjectId: 's1', topicId: 't3', topicName: 'Sem dados' }],
  });

  assert.equal(result.length, 3);
  assert.ok((result.find((topic) => topic.topicId === 't1')?.difficultyScore ?? 0) > 0.5);
  assert.ok((result.find((topic) => topic.topicId === 't2')?.difficultyScore ?? 0) < 0.5);
  assert.equal(result.find((topic) => topic.topicId === 't3')?.difficultyScore, 0.5);
});

test('agrega linhas do mesmo tópico e preserva a contagem de evidências', () => {
  const [topic] = buildWeeklySimulationDiagnostic({
    questions: [
      { monitorId: 'm1', subjectId: 's1', topicId: 't1', topicName: 'Tópico', answeredCount: 2, correctCount: 1 },
      { monitorId: 'm1', subjectId: 's1', topicId: 't1', topicName: 'Tópico', answeredCount: 3, correctCount: 3 },
    ],
    flashcards: [],
  });

  assert.equal(topic?.questionEvidenceCount, 5);
  assert.equal(topic?.questionIncorrectCount, 1);
});

test('consulta prática, simulados, desafios e flashcards na janela do ciclo', async () => {
  const calls: string[] = [];
  const window = { from: new Date('2026-09-04T03:00:00.000Z'), to: new Date('2026-09-11T03:00:00.000Z') };
  const service = new WeeklySimulationDiagnosticService({
    aggregateByScope: async (_studentId, _monitorIds, mode, receivedWindow) => {
      calls.push(`${mode}:${receivedWindow?.from.toISOString()}:${receivedWindow?.to.toISOString()}`);
      return [];
    },
    aggregateFlashcardByScope: async (_studentId, _monitorIds, receivedWindow) => {
      calls.push(`FLASHCARDS:${receivedWindow?.from.toISOString()}:${receivedWindow?.to.toISOString()}`);
      return [];
    },
  });

  const result = await service.collect({ studentId: 'student-1', monitorId: 'monitor-1', window });

  assert.deepEqual(calls.sort(), [
    'DAILY_CHALLENGE:2026-09-04T03:00:00.000Z:2026-09-11T03:00:00.000Z',
    'FLASHCARDS:2026-09-04T03:00:00.000Z:2026-09-11T03:00:00.000Z',
    'PRACTICE:2026-09-04T03:00:00.000Z:2026-09-11T03:00:00.000Z',
    'SIMULATED:2026-09-04T03:00:00.000Z:2026-09-11T03:00:00.000Z',
  ]);
  assert.deepEqual(result, []);
});
