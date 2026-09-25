import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentSnapshot, type PaymentSnapshotInput } from '../domain/contracts.js';

const baseInput: PaymentSnapshotInput = {
  priceCents: 5990,
  teacherPercentage: '50',
  referralPercentage: '0',
  teacherId: 'teacher-1',
  monitorId: 'monitor-1',
  payoutMode: 'TEACHER_ACCOUNT',
  walletId: 'wallet-1',
};

test('cria snapshot financeiro em centavos com percentual e carteira efetivos', () => {
  const snapshot = buildPaymentSnapshot(baseInput);

  assert.deepEqual(snapshot, {
    priceCents: 5990,
    teacherPercentage: '50.0000',
    referralPercentage: '0.0000',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    payoutMode: 'TEACHER_ACCOUNT',
    walletId: 'wallet-1',
  });
});

test('rejeita percentuais negativos, acima de cem e soma futura acima de cem', () => {
  assert.throws(() => buildPaymentSnapshot({ ...baseInput, teacherPercentage: '-1' }), /teacherPercentage/);
  assert.throws(() => buildPaymentSnapshot({ ...baseInput, teacherPercentage: '100.01' }), /teacherPercentage/);
  assert.throws(() => buildPaymentSnapshot({ ...baseInput, teacherPercentage: '90', referralPercentage: '11' }), /percentuais/);
});

test('fallback de plataforma não exige wallet do professor', () => {
  const snapshot = buildPaymentSnapshot({
    ...baseInput,
    payoutMode: 'PLATFORM_FALLBACK',
    walletId: null,
  });

  assert.equal(snapshot.payoutMode, 'PLATFORM_FALLBACK');
  assert.equal(snapshot.walletId, null);
});
