import assert from 'node:assert/strict';
import test from 'node:test';
import { TeacherService } from '../teacher.service.js';

const profile = { pageSlug: 'joao-professor', fullName: 'João Professor', monitors: [] };

test('retorna o perfil público do cache sem consultar o repositório', async () => {
  let repositoryCalls = 0;
  const service = new TeacherService({
    async findPublicBySlug() { repositoryCalls += 1; return profile; },
  } as any, {
    async get<T>() { return profile as T; },
    async set() {},
    async invalidate() {},
  } as any);

  const result = await service.findPublicProfile(profile.pageSlug);

  assert.deepEqual(result, profile);
  assert.equal(repositoryCalls, 0);
});

test('consulta o repositório e preenche o cache quando há miss', async () => {
  let repositoryCalls = 0;
  let cachedProfile: unknown = null;
  const service = new TeacherService({
    async findPublicBySlug() { repositoryCalls += 1; return profile; },
  } as any, {
    async get<T>() { return null as T | null; },
    async set(_slug: string, value: unknown) { cachedProfile = value; },
    async invalidate() {},
  } as any);

  const result = await service.findPublicProfile(profile.pageSlug);

  assert.deepEqual(result, profile);
  assert.equal(repositoryCalls, 1);
  assert.deepEqual(cachedProfile, profile);
});
