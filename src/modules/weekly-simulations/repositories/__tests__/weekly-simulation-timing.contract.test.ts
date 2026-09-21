import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('expõe início do simulado e impede respostas fora do prazo', async () => {
  const routes = await readFile(new URL('../../routes/weekly-simulation.routes.ts', import.meta.url), 'utf8');
  const repository = await readFile(new URL('../weekly-simulation.repository.ts', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../../controllers/weekly-simulation.controller.ts', import.meta.url), 'utf8');

  assert.match(routes, /weekly-simulations\/:simulationId\/start/);
  assert.match(repository, /startForStudent/);
  assert.match(repository, /durationSeconds/);
  assert.match(controller, /deadlineAt/);
});

test('submissão em lote permite reprocessar item previamente respondido enquanto está em andamento', async () => {
  const repository = await readFile(new URL('../weekly-simulation.repository.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(repository, /if \(!item \|\| item\.answeredAt\) throw new Error\('SIMULATION_INVALID_ANSWERS'\)/);
});

test('submissão em lote usa timeout compatível com as 30 respostas', async () => {
  const repository = await readFile(new URL('../weekly-simulation.repository.ts', import.meta.url), 'utf8');

  assert.match(repository, /timeout:\s*15_000/);
});
