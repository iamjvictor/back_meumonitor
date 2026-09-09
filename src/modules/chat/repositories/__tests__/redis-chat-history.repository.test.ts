import assert from 'node:assert/strict';
import test from 'node:test';
import { RedisChatHistoryRepository, CHAT_HISTORY_MAX_MESSAGES, CHAT_HISTORY_TTL_SECONDS } from '../redis-chat-history.repository.js';

function makeRedis() {
  const calls: Array<{ command: string; args: unknown[] }> = [];
  const redis = {
    async rpush(...args: unknown[]) { calls.push({ command: 'rpush', args }); return 1; },
    async ltrim(...args: unknown[]) { calls.push({ command: 'ltrim', args }); return 'OK'; },
    async expire(...args: unknown[]) { calls.push({ command: 'expire', args }); return 1; },
    async lrange(...args: unknown[]) {
      calls.push({ command: 'lrange', args });
      return [JSON.stringify({ id: 'message-1', role: 'student', content: 'Olá', createdAt: '2026-09-07T12:00:00.000Z' })];
    },
    async del(...args: unknown[]) { calls.push({ command: 'del', args }); return 1; },
  };
  return { redis, calls };
}

const scope = { studentId: 'student-1', monitorId: 'monitor-1', subjectId: 'subject-1' };

test('salva mensagem, limita histórico e renova TTL de cinco horas', async () => {
  const { redis, calls } = makeRedis();
  const repository = new RedisChatHistoryRepository(redis);

  await repository.append(scope, {
    id: 'message-1', role: 'student', content: 'Olá', createdAt: '2026-09-07T12:00:00.000Z',
  });

  assert.equal(calls[0]?.command, 'rpush');
  assert.equal(calls[1]?.command, 'ltrim');
  assert.deepEqual(calls[1]?.args.slice(1), [-CHAT_HISTORY_MAX_MESSAGES, -1]);
  assert.deepEqual(calls[2]?.args.slice(1), [CHAT_HISTORY_TTL_SECONDS]);
});

test('lista mensagens em ordem e remove somente o escopo informado', async () => {
  const { redis, calls } = makeRedis();
  const repository = new RedisChatHistoryRepository(redis);

  const messages = await repository.list(scope);
  await repository.clear(scope);

  assert.equal(messages[0]?.content, 'Olá');
  assert.equal(calls[0]?.command, 'lrange');
  assert.deepEqual(calls[0]?.args.slice(1), [0, -1]);
  assert.equal(calls[1]?.command, 'del');
  assert.equal(calls[1]?.args[0], 'chat:history:v1:student-1:monitor-1:subject-1');
});
