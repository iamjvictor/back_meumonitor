import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementController } from '../http/entitlement.controller.js';

test('GET /student/access resolve o snapshot usando o user.id autenticado', async () => {
  let receivedStudentId = '';
  const controller = new EntitlementController({
    async getSnapshot(studentId: string) {
      receivedStudentId = studentId;
      return { studentId, generatedAt: '2026-09-25T00:00:00.000Z', source: 'DATABASE', monitors: [], alerts: [] };
    },
  } as any, async (userId) => userId === 'supabase-user-1' ? 'student-1' : null);
  let payload: unknown;
  await controller.get({ user: { id: 'supabase-user-1' } } as any, { send(value: unknown) { payload = value; return this; } } as any);
  assert.equal(receivedStudentId, 'student-1');
  assert.deepEqual(payload, { data: { studentId: 'student-1', generatedAt: '2026-09-25T00:00:00.000Z', source: 'DATABASE', monitors: [], alerts: [] } });
});
