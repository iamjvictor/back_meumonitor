import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhookService } from '../webhook.service.js';

const purchase = {
  id: 'purchase-1', studentId: 'student-1', status: 'PENDING', totalAmount: 3980,
  currency: 'BRL', items: [{ monitorId: 'monitor-1', unitAmount: 1990 }, { monitorId: 'monitor-2', unitAmount: 1990 }],
};

function repository() {
  const events = new Map<string, any>();
  const repo: any = {
    events,
    findEvent: async (provider: string, id: string) => events.get(`${provider}:${id}`) ?? null,
    claimEvent: async (provider: string, data: any) => {
      const key = `${provider}:${data.providerEventId}`;
      if (events.has(key)) {
        const existing = events.get(key);
        if (existing.status === 'FAILED') existing.status = 'CLAIMED';
        return { created: false, event: existing };
      }
      const event = { id: `event-${events.size + 1}`, provider, ...data, status: 'CLAIMED' };
      events.set(key, event);
      return { created: true, event };
    },
    findPurchaseForWebhook: async (id: string) => id === purchase.id ? purchase : null,
    markFailed: async (id: string, message: string) => { for (const event of events.values()) if (event.id === id) event.status = 'FAILED'; return { id, status: 'FAILED', message }; },
    markProcessed: async (id: string) => { for (const event of events.values()) if (event.id === id) event.status = 'PROCESSED'; return { id, status: 'PROCESSED' }; },
    confirmAggregatedPurchase: async () => ({ purchaseId: purchase.id, status: 'PAID', subscriptionCount: 1, itemCount: 2, enrollmentCount: 2 }),
  };
  return repo;
}

const event = { providerEventId: 'evt-1', type: 'checkout.completed', purchaseId: purchase.id, amount: 3980, currency: 'BRL', customerId: 'customer-1', subscriptionId: 'sub-1' };

async function captureLogs<T>(operation: () => Promise<T>) {
  const original = console.log;
  const events: string[] = [];
  console.log = ((event: unknown) => { events.push(String(event)); }) as typeof console.log;
  try { return { result: await operation(), events }; }
  finally { console.log = original; }
}

test('processa dois monitores em uma assinatura e dois enrollments', async () => {
  const result = await new WebhookService(repository()).process('SIMULATED', event);
  assert.equal(result.status, 'PROCESSED');
  assert.equal(result.itemCount, 2);
  assert.equal(result.enrollmentCount, 2);
});

test('registra webhook aprovado e efeitos da assinatura em ordem', async () => {
  const { events } = await captureLogs(() => new WebhookService(repository()).process('SIMULATED', event));
  assert.deepEqual(events, [
    'monitor.billing_webhook_received',
    'monitor.billing_webhook_started',
    'monitor.billing_webhook_claimed',
    'monitor.billing_webhook_retry_claimed',
    'monitor.billing_webhook_validated',
    'monitor.billing_purchase_approval_started',
    'monitor.billing_purchase_approved',
    'monitor.billing_subscription_created',
    'monitor.billing_subscription_items_created',
    'monitor.billing_enrollments_created',
    'monitor.billing_webhook_processed',
  ]);
});

test('mesmo providerEventId é idempotente e não executa efeitos novamente', async () => {
  const repo = repository();
  let effects = 0;
  repo.confirmAggregatedPurchase = async () => { effects++; return { status: 'PAID' }; };
  const service = new WebhookService(repo);
  const first = await service.process('SIMULATED', event);
  const second = await service.process('SIMULATED', event);
  assert.equal(first.status, 'PROCESSED');
  assert.equal(second.idempotent, true);
  assert.equal(effects, 1);
});

test('rejeita valor divergente e marca o evento como FAILED', async () => {
  const repo = repository();
  await assert.rejects(() => new WebhookService(repo).process('SIMULATED', { ...event, amount: 1 }), /AMOUNT_MISMATCH/);
  assert.equal([...repo.events.values()][0].status, 'FAILED');
});

test('reprocessa evento FAILED e só retorna idempotente após executar efeitos', async () => {
  const repo = repository();
  let effects = 0;
  repo.confirmAggregatedPurchase = async () => { effects++; return { status: 'PAID' }; };
  const firstService = new WebhookService(repo);
  await assert.rejects(() => firstService.process('SIMULATED', { ...event, amount: 1 }), /AMOUNT_MISMATCH/);
  const second = await new WebhookService(repo).process('SIMULATED', event);
  assert.equal(second.idempotent, false);
  assert.equal(effects, 1);
  assert.equal([...repo.events.values()][0].status, 'PROCESSED');
});

test('mesmo providerEventId em providers diferentes cria eventos independentes', async () => {
  const repo = repository();
  let effects = 0;
  repo.confirmAggregatedPurchase = async () => { effects++; return { status: 'PAID' }; };
  await new WebhookService(repo).process('SIMULATED', event);
  await new WebhookService(repo).process('STRIPE', event);
  assert.equal(effects, 2);
  assert.equal(repo.events.size, 2);
});
