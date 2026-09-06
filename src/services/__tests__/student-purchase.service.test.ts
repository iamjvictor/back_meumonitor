import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutService as StudentPurchaseService } from '../../modules/billing/services/checkout.service.js';

const monitor = { id: 'm1', name: 'Monitor 1', status: 'PUBLISHED' };
const student = { id: 's1' };

function repository() {
  const sessions = new Map<string, any>();
  let paid = false;
  return {
    findStudentByUserId: async () => student,
    findPublishedMonitors: async () => [monitor],
    findActiveSubscriptions: async () => [],
    findPurchaseByIdempotencyKey: async () => null,
    createPurchase: async (input: any) => ({ id: 'p1', ...input, items: [{ monitorId: 'm1', unitAmount: 1990 }] }),
    findPurchaseForStudent: async () => ({ id: 'p1', studentId: 's1', status: paid ? 'PAID' : 'PENDING', totalAmount: 1990, currency: 'BRL', items: [{ monitorId: 'm1', unitAmount: 1990 }] }),
    createPaymentSession: async (input: any) => { const session = { id: 'session-1', ...input }; sessions.set(input.tokenHash, session); return session; },
    findPaymentSessionByTokenHash: async (tokenHash: string) => sessions.get(tokenHash),
    consumePaymentSession: async (id: string) => { const s = [...sessions.values()].find((value) => value.id === id); if (!s || s.consumedAt) return { consumed: false, session: s }; s.consumedAt = new Date(); return { consumed: true, session: s }; },
    confirmPurchase: async () => { paid = true; return { id: 'p1', status: 'PAID' }; },
    listPurchases: async () => [],
    listActiveSubscriptions: async () => [],
  } as any;
}

test('creates a purchase using backend price and rejects client price', async () => {
  const repo = repository();
  const service = new StudentPurchaseService(repo, { simulationEnabled: true, testPriceCents: 1990 });
  const result = await service.createPurchase('user-1', { monitorIds: ['m1'], paymentMethod: 'PIX' }, 'key-1');
  assert.equal(result.totalAmount, 1990);
  assert.equal(result.items[0].unitAmount, 1990);
});

test('rejects duplicate monitor ids', async () => {
  const service = new StudentPurchaseService(repository(), { simulationEnabled: true, testPriceCents: 1990 });
  await assert.rejects(() => service.createPurchase('user-1', { monitorIds: ['m1', 'm1'], paymentMethod: 'PIX' }, 'key-1'), /DUPLICATE_MONITOR/);
});

test('persists a bound session with hashed token and backend amount', async () => {
  const repo = repository();
  const service = new StudentPurchaseService(repo, { simulationEnabled: true, testPriceCents: 1990 });
  const purchase = await service.createPurchase('user-1', { monitorIds: ['m1'], paymentMethod: 'PIX' }, 'key-2');
  const checkout = await service.simulatedCheckout('user-1', purchase.id);
  assert.equal(checkout.amount, 1990);
  assert.notEqual(checkout.sessionId, undefined);
  assert.equal(typeof checkout.sessionId, 'string');
});

test('confirmation is idempotent for the same session and validates amount and currency', async () => {
  const repo = repository();
  let confirmations = 0;
  const confirm = repo.confirmPurchase;
  repo.confirmPurchase = async (...args: any[]) => { confirmations += 1; return confirm(...args); };
  const service = new StudentPurchaseService(repo, { simulationEnabled: true, testPriceCents: 1990 });
  await service.createPurchase('user-1', { monitorIds: ['m1'], paymentMethod: 'PIX' }, 'key-3');
  const checkout = await service.simulatedCheckout('user-1', 'p1');
  const first = await service.simulatedConfirmation('user-1', 'p1', checkout.sessionId);
  const second = await service.simulatedConfirmation('user-1', 'p1', checkout.sessionId);
  assert.equal(first.status, 'PAID');
  assert.equal(second.status, 'PAID');
  assert.equal(confirmations, 1);
});

test('rejects expired session', async () => {
  const repo = repository();
  repo.createPaymentSession = async (input: any) => { const session = { ...input, expiresAt: new Date(Date.now() - 1) }; (repo as any).expiredSession = session; return session; };
  const service = new StudentPurchaseService(repo, { simulationEnabled: true, testPriceCents: 1990 });
  await service.createPurchase('user-1', { monitorIds: ['m1'], paymentMethod: 'PIX' }, 'key-4');
  const checkout = await service.simulatedCheckout('user-1', 'p1');
  (repo as any).findPaymentSessionByTokenHash = async () => (repo as any).expiredSession;
  await assert.rejects(() => service.simulatedConfirmation('user-1', 'p1', checkout.sessionId), /SESSION_EXPIRED/);
});
