import assert from 'node:assert/strict';
import test from 'node:test';
import { getStudentEnrollmentStatusForSubscriptionEvent } from '../infrastructure/persistence/payment-event.repository.js';

test('mapeia assinatura deletada para REMOVED no enrollment', () => {
  assert.equal(getStudentEnrollmentStatusForSubscriptionEvent('SUBSCRIPTION_DELETED'), 'REMOVED');
});

test('mantém enrollment ativo quando o evento não encerra a assinatura', () => {
  assert.equal(getStudentEnrollmentStatusForSubscriptionEvent('SUBSCRIPTION_UPDATED'), 'ACTIVE');
});
