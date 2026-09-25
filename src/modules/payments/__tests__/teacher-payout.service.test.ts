import assert from 'node:assert/strict';
import test from 'node:test';
import { TeacherPayoutService } from '../application/services/teacher-payout.service.js';

test('calcula o repasse estimado e mantém separado o valor liquidado', async () => {
  const service = new TeacherPayoutService({
    async listForTeacher() {
      return [{
        studentId: 'student_1', studentName: 'Aluno 1', email: 'a@test.com', monitorId: 'monitor_1', monitorName: 'Matemática',
        subscriptionStatus: 'ACTIVE', itemStatus: 'ACTIVE', grossCents: 2990, teacherPercentageSnapshot: '50',
        expectedCents: 1495, settledCents: 1000, splitStatus: 'SETTLED', servicePeriodEnd: '2026-10-24T00:00:00.000Z',
      }];
    },
  });

  const result = await service.list('teacher_1');

  assert.deepEqual(result.items[0], {
    id: null, subscriptionId: null,
    studentId: 'student_1', studentName: 'Aluno 1', email: 'a@test.com', monitorId: 'monitor_1', monitorName: 'Matemática',
    subscriptionStatus: 'ACTIVE', itemStatus: 'ACTIVE', grossCents: 2990, teacherPercentageSnapshot: 50,
    expectedTeacherCents: 1495, settledTeacherCents: 1000, splitStatus: 'SETTLED', servicePeriodEnd: '2026-10-24T00:00:00.000Z',
    createdAt: null, updatedAt: null, cancelledAt: null,
  });
  assert.deepEqual(result.summary, { grossCents: 2990, expectedTeacherCents: 1495, settledTeacherCents: 1000, pendingTeacherCents: 495 });
});

test('ignora itens cancelados no resumo de repasse ativo', async () => {
  const service = new TeacherPayoutService({
    async listForTeacher() {
      return [
        {
          studentId: 's1', studentName: 'Aluno 1', email: 'a1@test.com', monitorId: 'm1', monitorName: 'M1',
          subscriptionStatus: 'ACTIVE', itemStatus: 'ACTIVE', grossCents: 2990, teacherPercentageSnapshot: 50,
          expectedCents: 1495, settledCents: 0, splitStatus: 'PENDING', servicePeriodEnd: null,
        },
        {
          studentId: 's2', studentName: 'Aluno 2', email: 'a2@test.com', monitorId: 'm2', monitorName: 'M2',
          subscriptionStatus: 'CANCELLED', itemStatus: 'CANCELLED', grossCents: 2990, teacherPercentageSnapshot: 50,
          expectedCents: 1495, settledCents: 0, splitStatus: 'PENDING', servicePeriodEnd: null,
        },
      ];
    },
  });

  const result = await service.list('teacher_1');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.summary, { grossCents: 2990, expectedTeacherCents: 1495, settledTeacherCents: 0, pendingTeacherCents: 1495 });
});

