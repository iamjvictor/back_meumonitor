export type PaymentAccountProjection = {
  status: string;
  generalStatus: string | null;
};

export function isPaymentAccountEligible(account: PaymentAccountProjection | null): boolean {
  if (!account) return false;
  if (account.status.toUpperCase() === 'SUSPENDED') return false;
  return account.status.toUpperCase() === 'APPROVED' || account.generalStatus?.toUpperCase() === 'APPROVED';
}

export function canPublishMonitor(input: { allowPublishWithoutPaymentAccount: boolean; account: PaymentAccountProjection | null }): boolean {
  return input.allowPublishWithoutPaymentAccount || isPaymentAccountEligible(input.account);
}
