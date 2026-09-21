import assert from 'node:assert/strict';
import test from 'node:test';
import { getWeeklySimulationCycle, getWeeklySimulationState } from '../weekly-simulation-cycle.service.js';

test('resolve a última sexta-feira às 23:59 no fuso de São Paulo', () => {
  const cycle = getWeeklySimulationCycle(new Date('2026-09-09T15:00:00.000Z'));

  assert.equal(cycle.cycleStartDate, '2026-09-04');
  assert.equal(cycle.cycleStart.toISOString(), '2026-09-05T02:59:00.000Z');
  assert.equal(cycle.analysisEnd.toISOString(), '2026-09-09T15:00:00.000Z');
});

test('não abre o ciclo da sexta antes das 23:59', () => {
  const cycle = getWeeklySimulationCycle(new Date('2026-09-11T03:00:00.000Z'));
  assert.equal(cycle.cycleStartDate, '2026-09-04');
});

test('abre o ciclo da sexta exatamente às 23:59', () => {
  const cycle = getWeeklySimulationCycle(new Date('2026-09-12T02:59:00.000Z'));
  assert.equal(cycle.cycleStartDate, '2026-09-11');
  assert.equal(cycle.cycleStart.toISOString(), '2026-09-12T02:59:00.000Z');
});

test('bloqueia novo simulado quando existe ciclo anterior incompleto', () => {
  assert.equal(getWeeklySimulationState({ current: null, previousIncomplete: { id: 'old', status: 'IN_PROGRESS' } }), 'BLOCKED_BY_PREVIOUS');
});

test('permite geração quando não há simulado atual nem anterior incompleto', () => {
  assert.equal(getWeeklySimulationState({ current: null, previousIncomplete: null }), 'AVAILABLE_TO_GENERATE');
});
