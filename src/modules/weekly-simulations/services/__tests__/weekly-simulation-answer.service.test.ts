import assert from 'node:assert/strict';
import test from 'node:test';
import { WeeklySimulationAnswerService } from '../weekly-simulation-answer.service.js';

test('calcula o acerto no backend e persiste a resposta do item', async () => {
  const calls: unknown[] = [];
  const service = new WeeklySimulationAnswerService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSimulationMonitor: async () => ({ monitorId: 'monitor-1' }),
      findItemForAnswer: async () => ({ id: 'item-1', simulationId: 'simulation-1', monitorId: 'monitor-1', correctAnswer: 'B', answered: false, simulationStatus: 'IN_PROGRESS' }),
      saveAnswer: async (input) => { calls.push(input); return { isCorrect: input.isCorrect, durationSeconds: null }; },
    },
  });

  const result = await service.answer('user-1', 'simulation-1', 'item-1', { selectedAnswer: 'b', responseTimeMs: 1200 });

  assert.equal(result.isCorrect, true);
  assert.deepEqual(calls, [{ studentId: 'student-1', simulationId: 'simulation-1', itemId: 'item-1', selectedAnswer: 'b', isCorrect: true, responseTimeMs: 1200 }]);
});

test('não cria segunda resposta para item já respondido', async () => {
  let saved = false;
  const service = new WeeklySimulationAnswerService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSimulationMonitor: async () => ({ monitorId: 'monitor-1' }),
      findItemForAnswer: async () => ({ id: 'item-1', simulationId: 'simulation-1', monitorId: 'monitor-1', correctAnswer: 'B', answered: true, simulationStatus: 'IN_PROGRESS', existing: { isCorrect: false } }),
      saveAnswer: async () => { saved = true; throw new Error('não deveria salvar'); },
    },
  });

  const result = await service.answer('user-1', 'simulation-1', 'item-1', { selectedAnswer: 'A' });

  assert.deepEqual(result, { alreadyAnswered: true, isCorrect: false, durationSeconds: null });
  assert.equal(saved, false);
});

test('consulta o item limitado ao aluno autenticado', async () => {
  let receivedStudentId = '';
  const service = new WeeklySimulationAnswerService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-2' }) },
    repository: {
      findSimulationMonitor: async () => ({ monitorId: 'monitor-1' }),
      findItemForAnswer: async ({ studentId }) => { receivedStudentId = studentId; return null; },
      saveAnswer: async () => { throw new Error('não deveria salvar'); },
    },
  });

  await assert.rejects(service.answer('user-2', 'simulation-1', 'item-1', { selectedAnswer: 'A' }), /SIMULATION_ITEM_NOT_FOUND/);
  assert.equal(receivedStudentId, 'student-2');
});

test('não aceita resposta enquanto a geração ainda está processando', async () => {
  const service = new WeeklySimulationAnswerService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSimulationMonitor: async () => ({ monitorId: 'monitor-1' }),
      findItemForAnswer: async () => ({ id: 'item-1', simulationId: 'simulation-1', monitorId: 'monitor-1', correctAnswer: 'A', answered: false, simulationStatus: 'PROCESSING' }),
      saveAnswer: async () => ({ isCorrect: true, durationSeconds: null }),
    },
  });
  await assert.rejects(service.answer('user-1', 'simulation-1', 'item-1', { selectedAnswer: 'A' }), /SIMULATION_NOT_ANSWERABLE/);
});

test('não aceita resposta depois do prazo do simulado', async () => {
  const service = new WeeklySimulationAnswerService({
    access: { assertMonitorAccess: async () => ({ studentId: 'student-1' }) },
    repository: {
      findSimulationMonitor: async () => ({ monitorId: 'monitor-1' }),
      findItemForAnswer: async () => ({ id: 'item-1', simulationId: 'simulation-1', monitorId: 'monitor-1', correctAnswer: 'A', answered: false, simulationStatus: 'IN_PROGRESS', deadlineAt: new Date(Date.now() - 1) }),
      saveAnswer: async () => ({ isCorrect: true, durationSeconds: null }),
    },
  });

  await assert.rejects(service.answer('user-1', 'simulation-1', 'item-1', { selectedAnswer: 'A' }), /SIMULATION_TIME_EXPIRED/);
});
