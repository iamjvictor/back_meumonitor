import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { PrismaChatAccessRepository } from '../prisma-chat-access.repository.js';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    student: { findUnique: async () => ({ id: 'student-1' }) },
    monitorSubject: { findFirst: async () => ({ id: 'subject-1', monitor: { teacherId: 'teacher-1' } }) },
    studentSubscription: { findFirst: async () => ({ id: 'subscription-1' }) },
    studentEnrollment: { findFirst: async () => null },
    teacher: { findUnique: async () => null },
    monitor: { findFirst: async () => null },
    ...overrides,
  } as unknown as PrismaClient;
}

test('resolve o aluno e autoriza monitor com assinatura ativa', async () => {
  const repository = new PrismaChatAccessRepository(makeClient());

  assert.deepEqual(
    await repository.resolveChatScope({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }),
    { studentId: 'student-1', teacherId: 'teacher-1', monitorId: 'monitor-1', subjectId: 'subject-1' },
  );
});

test('autoriza matrícula ativa quando não há assinatura', async () => {
  const repository = new PrismaChatAccessRepository(makeClient({
    studentSubscription: { findFirst: async () => null },
    studentEnrollment: { findFirst: async () => ({ id: 'enrollment-1' }) },
  }));

  assert.ok(await repository.resolveChatScope({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }));
});

test('nega quando o aluno não existe ou a matéria não pertence ao monitor', async () => {
  const noStudent = new PrismaChatAccessRepository(makeClient({ student: { findUnique: async () => null } }));
  const noSubject = new PrismaChatAccessRepository(makeClient({ monitorSubject: { findFirst: async () => null } }));

  assert.equal(await noStudent.resolveChatScope({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }), null);
  assert.equal(await noSubject.resolveChatScope({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-outro' }), null);
});

test('nega assinatura expirada', async () => {
  let subscriptionWhere: { OR?: Array<{ expiresAt?: unknown }> } | undefined;
  const repository = new PrismaChatAccessRepository(makeClient({
    studentSubscription: {
      findFirst: async (args: { where: { OR?: Array<{ expiresAt?: unknown }> } }) => {
        subscriptionWhere = args.where;
        return null;
      },
    },
  }));

  assert.equal(await repository.resolveChatScope({ userId: 'user-1', monitorId: 'monitor-1', subjectId: 'subject-1' }), null);
  const expiresAt = subscriptionWhere?.OR?.[1]?.expiresAt as { gte?: unknown } | undefined;
  assert.ok(expiresAt?.gte instanceof Date);
});
