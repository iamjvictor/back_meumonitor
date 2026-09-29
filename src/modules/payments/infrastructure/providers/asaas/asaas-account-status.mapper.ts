type AccountStatusMirror = {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  generalStatus?: string;
  commercialInfoStatus?: string;
  bankAccountStatus?: string;
  documentationStatus?: string;
  verified?: boolean;
};

const DIMENSIONS = [
  ['GENERAL_APPROVAL', 'generalStatus'],
  ['COMMERCIAL_INFO', 'commercialInfoStatus'],
  ['BANK_ACCOUNT_INFO', 'bankAccountStatus'],
  ['DOCUMENT', 'documentationStatus'],
] as const;

export function mapAsaasAccountStatusEvent(eventType: string): AccountStatusMirror | null {
  const normalized = eventType.trim().toUpperCase();
  const dimension = DIMENSIONS.find(([fragment]) => normalized.includes(fragment));
  if (!dimension) return null;

  const value = normalized.endsWith('_APPROVED')
    ? 'APPROVED'
    : normalized.endsWith('_REJECTED')
      ? 'REJECTED'
      : normalized.endsWith('_AWAITING_APPROVAL')
        ? 'AWAITING_APPROVAL'
        : normalized.endsWith('_PENDING')
          ? 'PENDING'
          : null;
  if (!value) return null;

  const [fragment, field] = dimension;
  const mirrored: AccountStatusMirror = { [field]: value };
  if (fragment === 'GENERAL_APPROVAL') {
    mirrored.status = value === 'APPROVED' ? 'APPROVED' : value === 'REJECTED' ? 'REJECTED' : 'PENDING';
    mirrored.verified = value === 'APPROVED';
  }
  return mirrored;
}
