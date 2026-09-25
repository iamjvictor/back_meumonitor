import assert from 'node:assert/strict';
import test from 'node:test';
import { readEffectiveSplits } from '../infrastructure/persistence/payment-event.repository.js';

test('normaliza split efetivo do Asaas em centavos e marca liquidação pelo evento', () => {
  const result = readEffectiveSplits({
    payment: {
      splits: [{ id: 'split-1', walletId: 'wallet-1', percentualValue: 70, totalValue: 20.93 }],
    },
  }, 2990, 'PAYMENT_SPLIT_DONE');

  assert.deepEqual(result, [{
    providerSplitId: 'split-1',
    walletId: 'wallet-1',
    effectivePercentage: 70,
    amountCents: 2093,
    settledCents: 2093,
    status: 'SETTLED',
  }]);
});

test('aceita o campo split singular enviado nos webhooks reais da Asaas', () => {
  const result = readEffectiveSplits({ payment: { split: [{ id: 'split-real', walletId: 'wallet-real', percentualValue: 50, totalValue: 14.41, status: 'AWAITING_CREDIT' }] } }, 2990, 'PAYMENT_CONFIRMED');

  assert.deepEqual(result, [{
    providerSplitId: 'split-real',
    walletId: 'wallet-real',
    effectivePercentage: 50,
    amountCents: 1441,
    settledCents: null,
    status: 'PENDING',
  }]);
});

test('ignora split sem identificador externo ou carteira', () => {
  assert.deepEqual(readEffectiveSplits({ payment: { splits: [{ totalValue: 20 }] } }, 2990, 'PAYMENT_RECEIVED'), []);
});
