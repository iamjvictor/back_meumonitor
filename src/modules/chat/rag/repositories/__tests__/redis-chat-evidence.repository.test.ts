import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_EVIDENCE_CACHE_TTL_SECONDS,
  RedisChatEvidenceRepository,
  buildChatEvidenceKey,
} from '../redis-chat-evidence.repository.js';
import type { ChatRagResult } from '../../models/chat-rag.model.js';

const scope = {
  teacherId: 'teacher-1',
  monitorId: 'monitor-1',
  subjectId: 'subject-1',
};

const rag: ChatRagResult = {
  used: true,
  retrievalQuery: 'mensagem privada do aluno',
  context: '[GABARITO OFICIAL]\nC',
  citations: [],
  metrics: { candidateCount: 1, selectedCount: 1, durationMs: 10 },
};

function makeRedis() {
  const values = new Map<string, string>();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const redis = {
    async get(key: string) {
      calls.push({ method: 'get', args: [key] });
      return values.get(key) ?? null;
    },
    async set(key: string, value: string, mode: string, seconds: number) {
      calls.push({ method: 'set', args: [key, value, mode, seconds] });
      values.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  };
  return { redis, calls, values };
}

test('usa chave de questão com escopo completo e TTL de cinco horas', async () => {
  const { redis, calls } = makeRedis();
  const repository = new RedisChatEvidenceRepository(redis);

  await repository.setQuestion({ ...scope, questionId: 'question-1' }, rag);
  const key = buildChatEvidenceKey('QUESTION', { ...scope, evidenceId: 'question-1' });
  const setCall = calls.find((call) => call.method === 'set');

  assert.equal(key, 'chat:rag:evidence:v1:QUESTION:teacher-1:monitor-1:subject-1:question-1');
  assert.deepEqual(setCall?.args.slice(0, 1), [key]);
  assert.equal(setCall?.args[2], 'EX');
  assert.equal(setCall?.args[3], CHAT_EVIDENCE_CACHE_TTL_SECONDS);
});

test('usa chave separada para flashcard e não persiste a consulta do aluno', async () => {
  const { redis, calls } = makeRedis();
  const repository = new RedisChatEvidenceRepository(redis);

  await repository.setFlashcard({ ...scope, flashcardId: 'flashcard-1' }, rag);
  const setCall = calls.find((call) => call.method === 'set');
  const stored = JSON.parse(String(setCall?.args[1])) as { rag: ChatRagResult };

  assert.equal(setCall?.args[0], 'chat:rag:evidence:v1:FLASHCARD:teacher-1:monitor-1:subject-1:flashcard-1');
  assert.equal(stored.rag.retrievalQuery, '');
  assert.doesNotMatch(String(setCall?.args[1]), /mensagem privada do aluno/);
});

test('rejeita entrada cujo escopo gravado não corresponde ao solicitado', async () => {
  const { redis, values } = makeRedis();
  const repository = new RedisChatEvidenceRepository(redis);
  const key = buildChatEvidenceKey('QUESTION', { ...scope, evidenceId: 'question-1' });
  values.set(key, JSON.stringify({
    version: 1,
    kind: 'QUESTION',
    evidenceId: 'question-1',
    teacherId: 'teacher-1',
    monitorId: 'other-monitor',
    subjectId: 'subject-1',
    rag,
  }));

  const result = await repository.getQuestion({ ...scope, questionId: 'question-1' });

  assert.equal(result, null);
});
