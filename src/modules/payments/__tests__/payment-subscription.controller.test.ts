import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentSubscriptionController } from '../http/payment-subscription.controller.js';

test('consulta detalhada retorna apenas assinatura do aluno autenticado', async () => {
  const controller = new PaymentSubscriptionController({
    async findStudentIdByUserId(userId: string) {
      assert.equal(userId, 'auth-user-1');
      return 'student-1';
    },
    async detailForStudent(studentId: string, subscriptionId: string) {
      assert.equal(studentId, 'student-1');
      assert.equal(subscriptionId, '06552fe3-9d29-498f-8281-5de1beda93aa');
      return { id: subscriptionId, studentId };
    },
  } as any, {} as any);
  let body: unknown;
  await controller.detail({ user: { id: 'auth-user-1', role: 'student' }, params: { subscriptionId: '06552fe3-9d29-498f-8281-5de1beda93aa' } } as any, { send(value: unknown) { body = value; return this; } } as any);
  assert.deepEqual(body, { data: { id: '06552fe3-9d29-498f-8281-5de1beda93aa', studentId: 'student-1' } });
});
