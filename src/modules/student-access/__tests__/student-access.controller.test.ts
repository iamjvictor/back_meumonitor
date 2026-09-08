import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentAccessController } from '../student-access.controller.js';

test('controller delega o cancelamento ao serviço', async () => {
  const calls: unknown[] = [];
  const controller = new StudentAccessController({
    async cancelMonitorAccess(input) {
      calls.push(input);
    },
  });

  await controller.cancelMonitorAccess({ userId: 'user-1', monitorId: 'monitor-1' });

  assert.deepEqual(calls, [{ userId: 'user-1', monitorId: 'monitor-1' }]);
});
