import assert from 'node:assert/strict';
import test from 'node:test';
import { WeeklySimulationSubmissionService } from '../weekly-simulation-submission.service.js';

test('envia todas as respostas em lote e não responde parcialmente', async () => {
  let received: unknown;
  const service = new WeeklySimulationSubmissionService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSubmissionContext: async () => ({ studentId: 'student-1', monitorId: 'monitor-1', status: 'IN_PROGRESS', deadlineAt: new Date(Date.now() + 60_000) }),
      submitAnswers: async (input) => { received = input; return { completed: true, durationSeconds: 120 }; },
    },
  });

  const result = await service.submit('user-1', 'simulation-1', [
    { itemId: 'item-1', selectedAnswer: 'A', responseTimeMs: 1200 },
    { itemId: 'item-2', selectedAnswer: 'B', responseTimeMs: 800 },
  ]);

  assert.deepEqual(received, { studentId: 'student-1', simulationId: 'simulation-1', answers: [{ itemId: 'item-1', selectedAnswer: 'A', responseTimeMs: 1200 }, { itemId: 'item-2', selectedAnswer: 'B', responseTimeMs: 800 }] });
  assert.deepEqual(result, { completed: true, durationSeconds: 120 });
});

test('não envia respostas depois do prazo', async () => {
  let called = false;
  const service = new WeeklySimulationSubmissionService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSubmissionContext: async () => ({ studentId: 'student-1', monitorId: 'monitor-1', status: 'IN_PROGRESS', deadlineAt: new Date(Date.now() - 1) }),
      submitAnswers: async () => { called = true; return { completed: true, durationSeconds: 1 }; },
    },
  });
  await assert.rejects(service.submit('user-1', 'simulation-1', [{ itemId: 'item-1', selectedAnswer: 'A' }]), /SIMULATION_TIME_EXPIRED/);
  assert.equal(called, false);
});
