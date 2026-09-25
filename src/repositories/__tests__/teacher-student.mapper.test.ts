import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTeacherStudentSubscription } from '../teacher-student.mapper.js';

test('mapeia somente a assinatura vinculada ao monitor do professor', () => {
  const result = mapTeacherStudentSubscription({
    student: { id: 'student-1', fullName: 'Ana Aluna', email: 'ana@example.com', avatarUrl: null },
    monitor: { id: 'monitor-1', name: 'Matemática', priceCents: 2990 },
    status: 'ACTIVE',
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    endsAt: null,
    subscriptionItem: null,
    paymentSubscriptionItem: {
      status: 'ACTIVE',
      priceCentsSnapshot: 2990,
      subscription: { status: 'ACTIVE', currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'), nextDueDate: new Date('2026-10-01T00:00:00.000Z') },
    },
  });

  assert.deepEqual(result, {
    studentId: 'student-1',
    fullName: 'Ana Aluna',
    email: 'ana@example.com',
    avatarUrl: null,
    monitorId: 'monitor-1',
    monitorName: 'Matemática',
    status: 'ACTIVE',
    priceCents: 2990,
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    nextDueDate: new Date('2026-10-01T00:00:00.000Z'),
  });
});
