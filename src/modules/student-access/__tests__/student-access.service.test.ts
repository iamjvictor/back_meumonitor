import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudentAccessService, StudentAccessDeniedError } from '../student-access.service.js';

function repository(overrides: Partial<Parameters<typeof createStudentAccessService>[0]> = {}) {
  return {
    findStudentByUserId: async () => ({ id: 'student-1' }),
    hasActiveSubscription: async () => false,
    hasActiveEnrollment: async () => false,
    ownsMonitor: async () => false,
    cancelSubscription: async () => undefined,
    cancelEnrollment: async () => undefined,
    ...overrides,
  };
}

test('autoriza aluno com assinatura ativa', async () => {
  const service = createStudentAccessService(repository({ hasActiveSubscription: async () => true }));

  const result = await service.assertMonitorAccess({ userId: 'user-1', monitorId: 'monitor-1' });

  assert.deepEqual(result, { studentId: 'student-1' });
});

test('autoriza professor proprietário do monitor', async () => {
  const service = createStudentAccessService(repository({ ownsMonitor: async () => true }));

  const result = await service.assertMonitorAccess({ userId: 'user-1', monitorId: 'monitor-1' });

  assert.deepEqual(result, { studentId: 'student-1' });
});

test('nega acesso quando não há assinatura, matrícula ou propriedade', async () => {
  const service = createStudentAccessService(repository());

  await assert.rejects(
    service.assertMonitorAccess({ userId: 'user-1', monitorId: 'monitor-1' }),
    (error: unknown) => error instanceof StudentAccessDeniedError,
  );
});

test('cancela assinatura e matrícula ativas do aluno', async () => {
  const calls: string[] = [];
  const service = createStudentAccessService(repository({
    cancelSubscription: async (studentId, monitorId) => calls.push(`subscription:${studentId}:${monitorId}`),
    cancelEnrollment: async (studentId, monitorId) => calls.push(`enrollment:${studentId}:${monitorId}`),
  }));

  await service.cancelMonitorAccess({ userId: 'user-1', monitorId: 'monitor-1' });

  assert.deepEqual(calls, ['subscription:student-1:monitor-1', 'enrollment:student-1:monitor-1']);
});
