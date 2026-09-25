import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementService, type EntitlementRepository, type EntitlementRepositoryRow } from '../application/entitlement.service.js';
import { RedisEntitlementCache, type EntitlementCacheClient } from '../infrastructure/redis-entitlement-cache.js';

function row(overrides: Partial<EntitlementRepositoryRow> = {}): EntitlementRepositoryRow {
  return {
    monitorId: 'monitor-1',
    monitorName: 'Matemática',
    monitorAvatarUrl: 'https://cdn.example.com/monitor.png',
    teacherAvatarUrl: 'https://cdn.example.com/teacher.png',
    teacherBannerUrl: 'https://cdn.example.com/teacher-banner.png',
    teacherId: 'teacher-1',
    teacherName: 'Professora',
    subscriptionId: 'sub-1',
    providerSubscriptionId: 'asaas-sub-1',
    subscriptionStatus: 'ACTIVE',
    itemStatus: 'ACTIVE',
    purchasedAt: '2026-09-01T00:00:00.000Z',
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2099-09-30T00:00:00.000Z',
    cancelRequestedAt: null,
    subjects: [{ id: 'subject-1', name: 'Álgebra', topics: [{ id: 'topic-1', name: 'Equações' }] }],
    approvedQuestionCount: 3,
    approvedFlashcardCount: 2,
    ...overrides,
  };
}

function fakeCache() {
  const values = new Map<string, string>();
  const calls = { get: 0, set: 0, del: 0 };
  const client: EntitlementCacheClient = {
    async get(key) { calls.get++; return values.get(key) ?? null; },
    async set(key, value, mode, ttl) { calls.set++; assert.equal(mode, 'EX'); assert.equal(ttl, 60); values.set(key, value); return 'OK'; },
    async del(key) { calls.del++; values.delete(key); return 1; },
  };
  return { cache: new RedisEntitlementCache(client, 'sandbox'), calls };
}

test('snapshot exclui pendentes, expira por accessEndsAt e deduplica monitor', async () => {
  const repository: EntitlementRepository = {
    async listForStudent() {
      return [
        row({ subscriptionId: 'sub-pending', subscriptionStatus: 'PENDING', itemStatus: 'ACTIVE' }),
        row({ subscriptionId: 'sub-active' }),
        row({ subscriptionId: 'sub-duplicate', providerSubscriptionId: 'asaas-sub-2' }),
        row({ monitorId: 'monitor-expired', currentPeriodEnd: '2020-01-01T00:00:00.000Z' }),
      ];
    },
  };
  const service = new EntitlementService(repository, fakeCache().cache, () => new Date('2026-09-25T00:00:00.000Z'));
  const snapshot = await service.getSnapshot('student-1');

  assert.deepEqual(snapshot.monitors.map((monitor) => monitor.monitorId), ['monitor-1']);
  assert.equal(snapshot.monitors[0]?.name, 'Matemática');
  assert.equal(snapshot.monitors[0]?.avatarUrl, 'https://cdn.example.com/monitor.png');
  assert.equal(snapshot.monitors[0]?.teacherAvatarUrl, 'https://cdn.example.com/teacher.png');
  assert.equal(snapshot.monitors[0]?.teacherBannerUrl, 'https://cdn.example.com/teacher-banner.png');
  assert.equal(snapshot.monitors[0]?.permissions.chat, true);
  assert.deepEqual(snapshot.alerts, [{ code: 'DUPLICATE_PROVIDER_SUBSCRIPTION', monitorId: 'monitor-1' }]);
});

test('cache hit não consulta o repositório e cache miss grava snapshot', async () => {
  let databaseReads = 0;
  const repository: EntitlementRepository = {
    async listForStudent() { databaseReads++; return [row()]; },
  };
  const fake = fakeCache();
  const service = new EntitlementService(repository, fake.cache, () => new Date('2026-09-25T00:00:00.000Z'));

  const first = await service.getSnapshot('student-1');
  const second = await service.getSnapshot('student-1');

  assert.equal(first.source, 'DATABASE');
  assert.equal(second.source, 'REDIS');
  assert.equal(databaseReads, 1);
  assert.equal(fake.calls.set, 1);
});

test('falha do Redis faz fallback ao banco e invalida apenas a chave do aluno', async () => {
  let databaseReads = 0;
  const repository: EntitlementRepository = { async listForStudent() { databaseReads++; return [row()]; } };
  const calls: string[] = [];
  const cache = new RedisEntitlementCache({
    async get() { throw new Error('redis down'); },
    async set() { throw new Error('redis down'); },
    async del(key) { calls.push(key); return 1; },
  }, 'production');
  const service = new EntitlementService(repository, cache, () => new Date('2026-09-25T00:00:00.000Z'));

  const snapshot = await service.getSnapshot('student-a');
  await service.invalidate('student-a', 'PAYMENT_CONFIRMED');

  assert.equal(snapshot.source, 'DATABASE');
  assert.equal(databaseReads, 1);
  assert.deepEqual(calls, ['entitlement:v1:production:student-a']);
});

test('hasMonitorAccess usa o mesmo snapshot canônico', async () => {
  const service = new EntitlementService({ async listForStudent() { return [row()]; } }, fakeCache().cache);
  assert.equal(await service.hasMonitorAccess('student-1', 'monitor-1'), true);
  assert.equal(await service.hasMonitorAccess('student-1', 'monitor-2'), false);
  assert.deepEqual(await service.getAccessibleMonitorIds('student-1'), ['monitor-1']);
});
