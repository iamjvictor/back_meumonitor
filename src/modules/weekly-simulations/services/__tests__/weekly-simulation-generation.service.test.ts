import assert from 'node:assert/strict';
import test from 'node:test';
import { WeeklySimulationGenerationService } from '../weekly-simulation-generation.service.js';

const cycle = { cycleStartDate: '2026-09-11', cycleStart: new Date('2026-09-11T03:00:00.000Z'), analysisEnd: new Date('2026-09-11T10:00:00.000Z') };

test('cria uma solicitação pendente e publica apenas um job idempotente', async () => {
  const published: unknown[] = [];
  const service = new WeeklySimulationGenerationService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    cycle: () => cycle,
    repository: {
      findByCycle: async () => null,
      findLatestIncompleteBeforeCycle: async () => null,
      createPending: async (input) => ({ id: 'simulation-1', status: 'PENDING', ...input }),
      resetFailedToPending: async () => { throw new Error('não deveria resetar'); },
    },
    publisher: { publish: async (job) => { published.push(job); } },
  });

  const result = await service.requestGeneration('user-1', 'monitor-1', cycle.analysisEnd);

  assert.equal(result.status, 'PENDING');
  assert.equal(result.simulationId, 'simulation-1');
  assert.deepEqual(published, [{ simulationId: 'simulation-1' }]);
});

test('bloqueia a geração quando o simulado do ciclo anterior está incompleto', async () => {
  let published = false;
  const service = new WeeklySimulationGenerationService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    cycle: () => cycle,
    repository: {
      findByCycle: async () => null,
      findLatestIncompleteBeforeCycle: async () => ({ id: 'simulation-old', status: 'IN_PROGRESS' }),
      createPending: async () => { throw new Error('não deveria criar'); },
      resetFailedToPending: async () => { throw new Error('não deveria resetar'); },
    },
    publisher: { publish: async () => { published = true; } },
  });

  const result = await service.requestGeneration('user-1', 'monitor-1', cycle.analysisEnd);

  assert.deepEqual(result, { simulationId: 'simulation-old', status: 'BLOCKED_BY_PREVIOUS' });
  assert.equal(published, false);
});

test('republica o job quando a geração atual falhou', async () => {
  let published = false;
  let reset = false;
  const service = new WeeklySimulationGenerationService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    cycle: () => cycle,
    repository: {
      findByCycle: async () => ({ id: 'simulation-failed', status: 'FAILED' }),
      findLatestIncompleteBeforeCycle: async () => null,
      createPending: async () => { throw new Error('não deveria criar'); },
      resetFailedToPending: async () => { reset = true; return { id: 'simulation-failed', status: 'PENDING' }; },
    },
    publisher: { publish: async () => { published = true; } },
  });

  const result = await service.requestGeneration('user-1', 'monitor-1', cycle.analysisEnd);

  assert.deepEqual(result, { simulationId: 'simulation-failed', status: 'PENDING' });
  assert.equal(reset, true);
  assert.equal(published, true);
});
