export type PayoutMode = 'TEACHER_ACCOUNT' | 'PLATFORM_FALLBACK';

export type PaymentSnapshotInput = {
  priceCents: number;
  teacherPercentage: string | number;
  referralPercentage: string | number;
  teacherId: string;
  monitorId: string;
  payoutMode: PayoutMode;
  walletId: string | null;
};

export type PaymentSnapshot = {
  priceCents: number;
  teacherPercentage: string;
  referralPercentage: string;
  teacherId: string;
  monitorId: string;
  payoutMode: PayoutMode;
  walletId: string | null;
};

function parsePercentage(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return parsed;
}

function formatPercentage(value: string | number, field: string): string {
  return parsePercentage(value, field).toFixed(4);
}

export function buildPaymentSnapshot(input: PaymentSnapshotInput): PaymentSnapshot {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
    throw new Error('priceCents must be a positive integer');
  }

  const teacherPercentage = parsePercentage(input.teacherPercentage, 'teacherPercentage');
  const referralPercentage = parsePercentage(input.referralPercentage, 'referralPercentage');
  if (teacherPercentage + referralPercentage > 100) {
    throw new Error('percentuais não podem ultrapassar 100');
  }

  if (input.payoutMode === 'TEACHER_ACCOUNT' && !input.walletId) {
    throw new Error('walletId is required for TEACHER_ACCOUNT');
  }

  return {
    priceCents: input.priceCents,
    teacherPercentage: teacherPercentage.toFixed(4),
    referralPercentage: referralPercentage.toFixed(4),
    teacherId: input.teacherId,
    monitorId: input.monitorId,
    payoutMode: input.payoutMode,
    walletId: input.walletId,
  };
}
