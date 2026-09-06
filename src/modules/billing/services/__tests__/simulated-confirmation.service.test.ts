import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { SimulatedConfirmationService } from '../simulated-confirmation.service.js';

test('valida a sessão e confirma a compra pelo webhook billing', async () => {
  let consumed = false;
  let received: any;
  const repo: any = {
    findStudentByUserId: async () => ({ id: 'student-1' }),
    findPaymentSessionByTokenHash: async (hash: string) => ({ id: 'session-1', purchaseId: 'purchase-1', studentId: 'student-1', tokenHash: hash, amount: 1990, currency: 'BRL', expiresAt: new Date(Date.now() + 60_000), consumedAt: null }),
    findPurchaseForStudent: async () => ({ id: 'purchase-1', studentId: 'student-1', status: 'PENDING', totalAmount: 1990, currency: 'BRL' }),
    consumePaymentSession: async () => { consumed = true; return { consumed: true }; },
  };
  const webhook = { process: async (provider: string, event: any) => { received = { provider, event }; return { status: 'PROCESSED', purchaseId: 'purchase-1' }; } };
  const result = await new SimulatedConfirmationService(repo, webhook as any).confirm('user-1', 'purchase-1', 'session-token');
  assert.equal(result.status, 'PAID');
  assert.equal(result.webhookStatus, 'PROCESSED');
  assert.equal(consumed, true);
  assert.equal(received.provider, 'SIMULATED');
  assert.equal(received.event.purchaseId, 'purchase-1');
  assert.equal(received.event.amount, 1990);
  assert.equal(received.event.providerEventId, `simulated:session-1`);
  assert.equal(crypto.createHash('sha256').update('session-token').digest('hex'), received.event.payload.sessionTokenHash);
});
