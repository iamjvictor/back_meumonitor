import assert from 'node:assert/strict';
import test from 'node:test';
import { SubscriptionService } from '../subscription.service.js';

const student = { id: 'student-1', email: 'student@example.com' };
const subscription = {
  id: 'billing-sub-1', studentId: student.id, providerSubscriptionId: 'sim-sub-1',
  billingInterval: 'MONTH', currency: 'BRL', subtotalAmount: 2000, discountAmount: 0,
  totalAmount: 2000, cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
  items: [{ id: 'item-1', monitorId: 'monitor-1', status: 'ACTIVE', amountBeforeDiscount: 2000, discountAmount: 0, finalAmount: 2000 }],
};

function setup(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input: any }> = [];
  const changes: any[] = [];
  const repo: any = {
    findStudentByUserId: async () => student,
    findSubscriptionForStudent: async () => subscription,
    findPublishedMonitor: async (id: string) => ({ id, name: `Monitor ${id}` }),
    findEnrollment: async () => null,
    updateSubscriptionTotals: async (id: string, data: any) => ({ ...subscription, ...data, id }),
    createItem: async (data: any) => ({ id: 'item-2', ...data }),
    updateItem: async (id: string, data: any) => ({ id, ...data }),
    upsertEnrollment: async (data: any) => data,
    markItemPendingRemoval: async (id: string, data: any) => ({ id, ...data }),
    markEnrollmentPendingRemoval: async (studentId: string, monitorId: string, data: any) => ({ studentId, monitorId, ...data }),
    countActiveItems: async () => 1,
    findChangeByOperationKey: async (key: string) => changes.find((change) => change.operationKey === key) ?? null,
    createChange: async (data: any) => { changes.push({ id: `change-${changes.length + 1}`, ...data }); return data; },
    ...overrides,
  };
  const provider: any = {
    updateSubscription: async (input: any) => { calls.push({ method: 'updateSubscription', input }); },
    cancelSubscription: async (input: any) => { calls.push({ method: 'cancelSubscription', input }); },
  };
  return { service: new SubscriptionService(repo, provider, { testPriceCents: 2000 }), repo, provider, calls, changes };
}

test('adiciona dois monitores na mesma assinatura agregada', async () => {
  const { service, calls } = setup({
    findEnrollment: async () => null,
    findSubscriptionForStudent: async () => ({ ...subscription, items: subscription.items }),
  });
  const result = await service.addMonitor(student.id, subscription.id, 'monitor-2');
  assert.equal(result.subscriptionId, subscription.id);
  const update = calls[0];
  assert.ok(update);
  assert.equal(update.input.effectiveAt, 'NOW');
  assert.equal(update.input.amount, 4000);
});

test('remove monitor mantém enrollment e item pendentes até o fim do período', async () => {
  const { service, calls, repo } = setup();
  const result = await service.removeMonitor(student.id, subscription.id, 'monitor-1');
  assert.equal(result.status, 'PENDING_REMOVAL');
  assert.equal(result.endsAt.toISOString(), subscription.currentPeriodEnd.toISOString());
  const update = calls[0];
  assert.ok(update);
  assert.equal(update.input.effectiveAt, 'PERIOD_END');
  assert.equal(repo.markItemPendingRemoval.mockCalled, undefined);
});

test('remoção do último monitor agenda cancelamento agregado', async () => {
  const { service, calls } = setup({ countActiveItems: async () => 1 });
  await service.removeMonitor(student.id, subscription.id, 'monitor-1');
  const cancel = calls[1];
  assert.deepEqual(cancel, { method: 'cancelSubscription', input: { subscriptionId: 'sim-sub-1', atPeriodEnd: true } });
});

test('altera MONTH para YEAR recalculando o total e preservando a assinatura', async () => {
  const { service, calls } = setup();
  const result = await service.changeInterval(student.id, subscription.id, 'YEAR');
  assert.equal(result.subscriptionId, subscription.id);
  const update = calls[0];
  assert.ok(update);
  assert.equal(update.input.interval, 'YEAR');
  assert.equal(update.input.amount, 24000);
  assert.equal(update.input.effectiveAt, 'NOW');
});

test('reativa item e enrollment pendentes sem criar outra linha', async () => {
  const pendingItem = { ...subscription.items[0], status: 'PENDING_REMOVAL' };
  const updates: any[] = [];
  const { service, repo } = setup({
    findEnrollment: async () => ({ id: 'enrollment-1', status: 'PENDING_REMOVAL', subscriptionItemId: pendingItem.id }),
    findSubscriptionForStudent: async () => ({ ...subscription, items: [pendingItem] }),
    updateItem: async (id: string, data: any) => { updates.push({ id, data }); return { id, ...data }; },
    upsertEnrollment: async (data: any) => { updates.push({ enrollment: data }); return data; },
  });
  await service.addMonitor(student.id, subscription.id, 'monitor-1');
  assert.equal(updates.some((u) => u.id === 'item-1' && u.data.status === 'ACTIVE'), true);
  assert.equal(updates.some((u) => u.enrollment?.status === 'ACTIVE'), true);
  assert.equal((repo.createItem as any).called, undefined);
});

test('não persiste sucesso quando provider falha', async () => {
  let persisted = false;
  const { service } = setup({
    updateSubscriptionTotals: async () => { persisted = true; },
  });
  const provider = (service as any).provider;
  provider.updateSubscription = async () => { throw new Error('PROVIDER_DOWN'); };
  await assert.rejects(() => service.changeInterval(student.id, subscription.id, 'YEAR'), /PROVIDER_DOWN/);
  assert.equal(persisted, false);
});

test('registra histórico append-only por alteração', async () => {
  const changes: any[] = [];
  const { service } = setup({ createChange: async (data: any) => { changes.push(data); return data; } });
  await service.changeInterval(student.id, subscription.id, 'YEAR');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'INTERVAL_CHANGE');
  assert.ok(changes[0].operationKey);
});

for (const [name, invoke] of [
  ['add', (service: SubscriptionService, key: string) => service.addMonitor(student.id, subscription.id, 'monitor-2', key)],
  ['remove', (service: SubscriptionService, key: string) => service.removeMonitor(student.id, subscription.id, 'monitor-1', key)],
  ['interval', (service: SubscriptionService, key: string) => service.changeInterval(student.id, subscription.id, 'YEAR', key)],
  ['cancel', (service: SubscriptionService, key: string) => service.cancel(student.id, subscription.id, key)],
] as const) {
  test(`idempotência faz replay de ${name} sem chamar provider novamente`, async () => {
    const state = setup();
    const first = await invoke(state.service, `idem-${name}-123`);
    const callsAfterFirst = state.calls.length;
    const second = await invoke(state.service, `idem-${name}-123`);
    assert.deepEqual(second, first);
    assert.equal(state.calls.length, callsAfterFirst);
    assert.equal(state.changes.length, 1);
  });
}

test('rejeita chave usada em outra operação ou monitor', async () => {
  const state = setup();
  await state.service.addMonitor(student.id, subscription.id, 'monitor-2', 'shared-key-123');
  await assert.rejects(() => state.service.addMonitor(student.id, subscription.id, 'monitor-3', 'shared-key-123'), /IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(() => state.service.changeInterval(student.id, subscription.id, 'YEAR', 'shared-key-123'), /IDEMPOTENCY_KEY_REUSED/);
  assert.equal(state.changes.length, 1);
});
