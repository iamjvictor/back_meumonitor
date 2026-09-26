import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentSubscriptionController } from '../http/payment-subscription.controller.js';
import { PaymentSubscriptionProviderError } from '../application/services/payment-subscription.service.js';

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

test('expõe erro temporário do provedor ao aluno durante o cancelamento', async () => {
  const controller = new PaymentSubscriptionController({
    async findStudentIdByUserId() { return 'student-1'; },
  } as any, {
    async cancelItem() { throw new PaymentSubscriptionProviderError(); },
  } as any);

  await assert.rejects(
    () => controller.remove({
      user: { id: 'auth-user-1', role: 'student' },
      params: { subscriptionId: '06552fe3-9d29-498f-8281-5de1beda93aa', monitorId: '6aa52fe3-9d29-498f-8281-5de1beda93aa' },
      headers: { 'idempotency-key': 'cancel-12345678' },
    } as any, {} as any),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'PAYMENT_PROVIDER_ERROR');
      assert.equal((error as { statusCode?: number }).statusCode, 503);
      assert.equal((error as { publicMessage?: string }).publicMessage, 'Não foi possível confirmar o cancelamento com a operadora. Tente novamente em alguns instantes.');
      return true;
    },
  );
});
