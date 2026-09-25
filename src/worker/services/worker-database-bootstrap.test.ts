import assert from 'node:assert/strict';
import test from 'node:test';
import { loadQuestionGenerationEnumState } from './worker-database-bootstrap.js';

test('retry da inicialização do worker recupera timeout transitório do banco', async () => {
  let calls = 0;
  const state = await loadQuestionGenerationEnumState(async () => {
      calls += 1;
      if (calls < 3) throw new Error('SocketTimeout');
      return [{ hasCorrection: true, hasNormalization: true }];
    }, { attempts: 3, delayMs: 0, sleep: async () => {} });

  assert.deepEqual(state, { hasCorrection: true, hasNormalization: true });
  assert.equal(calls, 3);
});

test('retry da inicialização preserva erro após esgotar tentativas', async () => {
  await assert.rejects(
    () => loadQuestionGenerationEnumState(async () => { throw new Error('SocketTimeout'); }, { attempts: 2, delayMs: 0, sleep: async () => {} }),
    /SocketTimeout/,
  );
});
