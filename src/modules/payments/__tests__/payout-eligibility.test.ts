import assert from 'node:assert/strict';
import test from 'node:test';
import { isPaymentAccountEligible, canPublishMonitor } from '../application/queries/get-payout-eligibility.use-case.js';

test('conta aprovada é elegível para recebimento', () => {
  assert.equal(isPaymentAccountEligible({ status: 'APPROVED', generalStatus: null }), true);
  assert.equal(isPaymentAccountEligible({ status: 'PENDING', generalStatus: 'APPROVED' }), true);
});

test('conta pendente, rejeitada ou suspensa não é elegível', () => {
  assert.equal(isPaymentAccountEligible(null), false);
  assert.equal(isPaymentAccountEligible({ status: 'PENDING', generalStatus: 'PENDING' }), false);
  assert.equal(isPaymentAccountEligible({ status: 'REJECTED', generalStatus: 'REJECTED' }), false);
  assert.equal(isPaymentAccountEligible({ status: 'SUSPENDED', generalStatus: 'APPROVED' }), false);
});

test('dispensa administrativa permite publicação sem conta elegível', () => {
  assert.equal(canPublishMonitor({ allowPublishWithoutPaymentAccount: true, account: null }), true);
  assert.equal(canPublishMonitor({ allowPublishWithoutPaymentAccount: false, account: null }), false);
});
