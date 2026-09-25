import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CreateCheckoutUseCase, CheckoutPendingError, CheckoutStudentRoleError } from '../application/commands/create-checkout.use-case.js';
import type { CheckoutMonitor, CreateCheckoutRepository } from '../infrastructure/persistence/payment-checkout.repository.js';

const monitor: CheckoutMonitor = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Monitor de Matemática',
  priceCents: 5990,
  teacher: {
    id: '22222222-2222-4222-8222-222222222222',
    teacherPercentage: new Prisma.Decimal('50'),
    currentPaymentAccount: { walletId: 'wallet_teacher', status: 'APPROVED', generalStatus: 'APPROVED' },
    referralReceived: { indicatorTeacherId: '33333333-3333-4333-8333-333333333333', percentage: new Prisma.Decimal('5'), status: 'ACTIVE' },
  },
};

function repository(overrides: Partial<CreateCheckoutRepository> = {}): CreateCheckoutRepository {
  const order = { id: 'order_1', subscriptionId: 'subscription_1', status: 'PENDING', amountCents: 5990 };
  return {
    findStudentByUserId: async () => ({ id: 'student_1', role: 'student' }),
    findPublishedMonitor: async () => monitor,
    hasActiveSubscription: async () => false,
    findIdempotency: async () => null,
    resetFailedIdempotency: async () => undefined,
    createIntent: async () => ({ order, checkout: null, payout: { walletId: 'wallet_teacher', percentage: '50.0000' } }),
    saveCheckout: async (_orderId, checkout) => ({ order, checkout: { checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt }, payout: { walletId: 'wallet_teacher', percentage: '50.0000' } }),
    markCheckoutCreationFailed: async () => undefined,
    ...overrides,
  };
}

test('cria checkout mensal com o preço e a comissão congelados no pedido', async () => {
  let command: any;
  const provider = { async createHostedCheckout(input: any) { command = input; return { providerCheckoutId: 'co_1', checkoutUrl: 'https://sandbox.asaas.com/checkout/co_1', expiresAt: new Date('2026-10-01T00:00:00.000Z') }; } };
  const useCase = new CreateCheckoutUseCase(repository(), provider);

  const result = await useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_1', returnBaseUrl: 'http://localhost:3000' });

  assert.equal(result.amountCents, 5990);
  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkout/co_1');
  assert.deepEqual(command.splits, [{ walletId: 'wallet_teacher', percentage: '50.0000' }]);
  assert.match(command.successUrl, /orderId=order_1/);
  assert.match(command.successUrl, /\/areadoaluno\?/);
});

test('permite iniciar nova compra mesmo com assinatura ativa do mesmo monitor', async () => {
  let providerCalled = false;
  const repo = repository({ hasActiveSubscription: async () => true });
  const useCase = new CreateCheckoutUseCase(repo, {
    async createHostedCheckout() {
      providerCalled = true;
      return { providerCheckoutId: 'co_duplicate_allowed', checkoutUrl: 'https://sandbox.asaas.com/checkout/co_duplicate_allowed', expiresAt: null };
    },
  });

  const result = await useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_duplicate_allowed', returnBaseUrl: 'https://frontend.test' });

  assert.equal(providerCalled, true);
  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkout/co_duplicate_allowed');
});

test('não permite iniciar checkout com papel diferente de student', async () => {
  const repo = repository({ findStudentByUserId: async () => ({ id: 'teacher_1', role: 'teacher' }) });
  const useCase = new CreateCheckoutUseCase(repo, { async createHostedCheckout() { throw new Error('não deveria chamar o Asaas'); } });
  await assert.rejects(() => useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_1', returnBaseUrl: 'http://localhost:3000' }), CheckoutStudentRoleError);
});

test('cria checkout sem split quando a conta do professor não está elegível', async () => {
  let command: any;
  const provider = { async createHostedCheckout(input: any) { command = input; return { providerCheckoutId: 'co_2', checkoutUrl: 'https://sandbox.asaas.com/checkout/co_2', expiresAt: null }; } };
  const repo = repository({
    findPublishedMonitor: async () => ({ ...monitor, teacher: { ...monitor.teacher, currentPaymentAccount: { walletId: 'wallet_teacher', status: 'PENDING', generalStatus: 'PENDING' } } }),
    createIntent: async () => ({ order: { id: 'order_2', subscriptionId: 'subscription_2', status: 'PENDING', amountCents: 5990 }, checkout: null, payout: { walletId: null, percentage: '0.0000' } }),
  });
  await new CreateCheckoutUseCase(repo, provider).execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_2', returnBaseUrl: 'http://localhost:3000' });
  assert.deepEqual(command.splits, []);
});

test('não cria outro checkout quando a mesma intenção ainda não tem URL conciliada', async () => {
  const fingerprint = createHash('sha256').update(JSON.stringify({ monitorId: monitor.id })).digest('hex');
  const repo = repository({ findIdempotency: async () => ({ requestFingerprint: fingerprint, state: 'IN_PROGRESS', order: { id: 'order_3', subscriptionId: 'subscription_3', status: 'PENDING', amountCents: 5990 }, checkout: null }) });
  const useCase = new CreateCheckoutUseCase(repo, { async createHostedCheckout() { throw new Error('não deveria chamar o Asaas'); } });
  await assert.rejects(() => useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_3', returnBaseUrl: 'http://localhost:3000' }), CheckoutPendingError);
});

test('permite retry quando a tentativa anterior falhou', async () => {
  const fingerprint = createHash('sha256').update(JSON.stringify({ monitorId: monitor.id })).digest('hex');
  let resetCalled = false;
  let providerCalled = false;
  const repo = repository({
    findIdempotency: async () => ({ requestFingerprint: fingerprint, state: 'FAILED', order: { id: 'order_failed', subscriptionId: 'subscription_failed', status: 'CHECKOUT_CREATION_FAILED', amountCents: 5990 }, checkout: null }),
    resetFailedIdempotency: async () => { resetCalled = true; },
  });
  const useCase = new CreateCheckoutUseCase(repo, { async createHostedCheckout() { providerCalled = true; return { providerCheckoutId: 'co_retry', checkoutUrl: 'https://sandbox.asaas.com/checkout/co_retry', expiresAt: null }; } });

  const result = await useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_failed_retry', returnBaseUrl: 'https://frontend.test' });

  assert.equal(resetCalled, true);
  assert.equal(providerCalled, true);
  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkout/co_retry');
});

test('registra falha quando não consegue salvar o checkout depois da resposta do provedor', async () => {
  let failedOrderId: string | undefined;
  let failedMessage: string | undefined;
  const repo = repository({
    saveCheckout: async () => { throw new Error('payment_checkouts indisponível'); },
    markCheckoutCreationFailed: async (orderId, message) => {
      failedOrderId = orderId;
      failedMessage = message;
    },
  });
  const useCase = new CreateCheckoutUseCase(repo, {
    async createHostedCheckout() {
      return { providerCheckoutId: 'co_persistence_failure', checkoutUrl: 'https://sandbox.asaas.com/checkout/co_persistence_failure', expiresAt: null };
    },
  });

  await assert.rejects(
    () => useCase.execute('user_1', { monitorId: monitor.id, idempotencyKey: 'key_persistence_failure', returnBaseUrl: 'https://frontend.test' }),
    { message: 'payment_checkouts indisponível' },
  );
  assert.equal(failedOrderId, 'order_1');
  assert.equal(failedMessage, 'payment_checkouts indisponível');
});
