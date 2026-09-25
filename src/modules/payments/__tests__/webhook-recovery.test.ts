import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecoverableWebhookState } from '../infrastructure/persistence/prisma-webhook.repository.js';

test('não agenda automaticamente webhooks aguardando correlação', () => {
  assert.equal(isRecoverableWebhookState('WAITING_CORRELATION'), false);
});

test('agenda webhooks recebidos e falhos para recuperação', () => {
  assert.equal(isRecoverableWebhookState('RECEIVED'), true);
  assert.equal(isRecoverableWebhookState('FAILED'), true);
});
