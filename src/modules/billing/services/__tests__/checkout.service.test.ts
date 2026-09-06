import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckoutService } from '../checkout.service.js';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

function setup(existing: any = null) {
  const calls = { customer: 0, checkout: 0, createPurchase: 0, session: 0 };
  const repo: any = {
    findStudentByUserId: async () => ({ id: 'student-1', email: 'student@example.com' }),
    findPublishedMonitors: async (monitorIds: string[]) => monitorIds.map((id) => ({ id, name: `Monitor ${id}` })),
    findActiveSubscriptions: async () => [],
    findPurchaseByIdempotencyKey: async () => existing,
    createPurchase: async (data: any) => { calls.createPurchase++; return { id: 'purchase-1', ...data, items: data.items.create }; },
    updatePurchaseCheckoutReference: async () => undefined,
    createPaymentSession: async (data: any) => { calls.session++; return { id: 'session-1', ...data }; },
  };
  const customerRepo: any = {
    findStudentByUserId: async () => ({ id: 'student-1', email: 'student@example.com' }),
    upsert: async (data: any) => { calls.customer++; return { id: 'customer-row-1', studentId: data.studentId, providerCustomerId: data.providerCustomerId }; },
  };
  const provider: any = {
    getOrCreateCustomer: async () => { calls.customer++; return { customerId: 'cus_simulated' }; },
    createCheckout: async () => { calls.checkout++; return { checkoutId: 'checkout-1', checkoutUrl: '/checkout/simulado', expiresAt: new Date('2030-01-01') }; },
  };
  return { service: new CheckoutService(repo, customerRepo, provider, { simulationEnabled: true, testPriceCents: 1990 }), repo, calls };
}

async function captureLogs<T>(operation: () => Promise<T>) {
  const original = console.log;
  const events: string[] = [];
  console.log = ((event: unknown) => { events.push(String(event)); }) as typeof console.log;
  try { return { result: await operation(), events }; }
  finally { console.log = original; }
}

test('cria uma compra PENDING agregada para dois monitores e um checkout', async () => {
  const { service, calls } = setup();
  const result = await service.createCheckout('user-1', { monitorIds: ids, paymentMethod: 'PIX', interval: 'MONTH' }, 'key-1');
  assert.equal(result.purchaseId, 'purchase-1');
  assert.equal(result.amount, 3980);
  assert.equal(result.currency, 'BRL');
  assert.equal(result.checkoutId, 'checkout-1');
  assert.equal(calls.createPurchase, 1);
  assert.equal(calls.checkout, 1);
  assert.equal(calls.session, 1);
});

test('registra o checkout em ordem, da solicitação à URL criada', async () => {
  const { service } = setup();
  const { events } = await captureLogs(() => service.createCheckout('user-1', { monitorIds: ids, paymentMethod: 'PIX', interval: 'MONTH' }, 'key-logs'));
  assert.deepEqual(events, [
    'monitor.billing_checkout_requested',
    'monitor.billing_checkout_started',
    'monitor.billing_checkout_validated',
    'monitor.billing_checkout_amount_calculated',
    'monitor.billing_purchase_creation_started',
    'monitor.billing_purchase_created',
    'monitor.billing_customer_resolved',
    'monitor.billing_checkout_url_requested',
    'monitor.billing_checkout_url_created',
    'monitor.billing_checkout_completed',
  ]);
});

test('chave repetida do mesmo aluno retorna o checkout já criado sem chamar provider', async () => {
  const existing = { id: 'purchase-existing', studentId: 'student-1', status: 'PENDING', totalAmount: 3980, currency: 'BRL', gatewayCheckoutId: 'checkout-existing' };
  const { service, calls } = setup(existing);
  const result = await service.createCheckout('user-1', { monitorIds: ids, paymentMethod: 'PIX', interval: 'MONTH' }, 'key-1');
  assert.equal(result.purchaseId, 'purchase-existing');
  assert.equal(calls.checkout, 0);
  assert.equal(calls.createPurchase, 0);
});

test('replay da compra existente cria nova sessão temporária sem duplicar checkout', async () => {
  const existing = { id: 'purchase-existing', studentId: 'student-1', status: 'PENDING', totalAmount: 1990, currency: 'BRL', gatewayCheckoutId: 'simulated:checkout-existing' };
  const { service, calls, repo } = setup(existing);
  repo.createPaymentSession = async (data: any) => { calls.session++; return { id: 'session-replayed', ...data }; };
  const result = await service.createCheckout('user-1', { monitorIds: [ids[0]!], paymentMethod: 'PIX', interval: 'MONTH' }, 'key-replay');
  assert.equal(result.purchaseId, 'purchase-existing');
  assert.equal(result.status, 'PENDING');
  assert.equal(typeof result.sessionId, 'string');
  assert.equal(calls.checkout, 0);
  assert.equal(calls.createPurchase, 0);
  assert.equal(calls.session, 1);
});

test('chave usada por outro aluno é rejeitada', async () => {
  const { service } = setup({ id: 'purchase-other', studentId: 'student-2', status: 'PENDING' });
  await assert.rejects(() => service.createCheckout('user-1', { monitorIds: ids, paymentMethod: 'PIX', interval: 'MONTH' }, 'key-1'), { message: 'IDEMPOTENCY_KEY_REUSED' });
});
