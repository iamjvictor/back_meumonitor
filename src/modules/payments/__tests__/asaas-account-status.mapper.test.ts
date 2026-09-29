import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAsaasAccountStatusEvent } from '../infrastructure/providers/asaas/asaas-account-status.mapper.js';

test('aprovação de documento espelha somente a dimensão documental e não aprova a conta', () => {
  assert.deepEqual(mapAsaasAccountStatusEvent('ACCOUNT_STATUS_DOCUMENT_APPROVED'), {
    documentationStatus: 'APPROVED',
  });
});

test('aprovação geral libera a conta e registra o espelho geral', () => {
  assert.deepEqual(mapAsaasAccountStatusEvent('ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED'), {
    status: 'APPROVED',
    generalStatus: 'APPROVED',
    verified: true,
  });
});

test('rejeição geral bloqueia a conta', () => {
  assert.deepEqual(mapAsaasAccountStatusEvent('ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED'), {
    status: 'REJECTED',
    generalStatus: 'REJECTED',
    verified: false,
  });
});
