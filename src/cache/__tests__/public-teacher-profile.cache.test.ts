import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicTeacherProfileCache, PUBLIC_TEACHER_PROFILE_CACHE_TTL_SECONDS, buildPublicTeacherProfileCacheKey } from '../public-teacher-profile.cache.js';

function fakeRedis() {
  const values = new Map<string, string>();
  const calls = { get: 0, set: 0, del: 0 };
  return {
    calls,
    redis: {
      async get(key: string) { calls.get += 1; return values.get(key) ?? null; },
      async set(key: string, value: string, mode: 'EX', ttl: number) { calls.set += 1; values.set(key, value); assert.equal(mode, 'EX'); assert.equal(ttl, PUBLIC_TEACHER_PROFILE_CACHE_TTL_SECONDS); return 'OK'; },
      async del(key: string) { calls.del += 1; values.delete(key); return 1; },
    },
  };
}

test('salva e recupera perfil público do professor com TTL', async () => {
  const { redis, calls } = fakeRedis();
  const cache = new PublicTeacherProfileCache(redis);
  const profile = { pageSlug: 'joao-professor', fullName: 'João Professor', monitors: [] };

  await cache.set(profile.pageSlug, profile);

  assert.deepEqual(await cache.get(profile.pageSlug), profile);
  assert.equal(calls.set, 1);
  assert.equal(calls.get, 1);
  assert.equal(buildPublicTeacherProfileCacheKey(profile.pageSlug), 'teacher:public-profile:v1:joao-professor');
});

test('invalida o perfil público pelo slug', async () => {
  const { redis, calls } = fakeRedis();
  const cache = new PublicTeacherProfileCache(redis);

  await cache.set('joao-professor', { pageSlug: 'joao-professor' });
  await cache.invalidate('joao-professor');

  assert.equal(await cache.get('joao-professor'), null);
  assert.equal(calls.del, 1);
});
