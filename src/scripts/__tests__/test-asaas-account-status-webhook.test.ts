import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountStatusWebhookPayload } from '../test-asaas-account-status-webhook.js';

test('monta um evento de aprovação da subconta com identificador único', () => {
  const payload = buildAccountStatusWebhookPayload('b7b7fc29-ca47-4e43-abec-3202e38a6f81');

  assert.equal(payload.event, 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED');
  assert.equal(payload.account.id, 'b7b7fc29-ca47-4e43-abec-3202e38a6f81');
  assert.match(payload.id, /^evt_test_account_approved_/);
  assert.equal(payload.account.status, 'APPROVED');
});
