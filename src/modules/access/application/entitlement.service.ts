import type { RedisEntitlementCache } from '../infrastructure/redis-entitlement-cache.js';

export type EntitlementRepositoryRow = {
  monitorId: string; monitorName: string; monitorAvatarUrl: string | null; teacherId: string; teacherName: string; teacherAvatarUrl: string | null; teacherBannerUrl: string | null;
  subscriptionId: string; providerSubscriptionId: string | null;
  subscriptionStatus: string; itemStatus: string; purchasedAt: string;
  currentPeriodStart: string | null; currentPeriodEnd: string | null;
  cancelRequestedAt: string | null;
  subjects: Array<{ id: string; name: string; topics: Array<{ id: string; name: string }> }>;
  approvedQuestionCount: number; approvedFlashcardCount: number;
};

export type EntitlementRepository = { listForStudent(studentId: string): Promise<EntitlementRepositoryRow[]> };
export type EntitlementMonitor = Omit<EntitlementRepositoryRow, 'subscriptionStatus' | 'itemStatus'> & {
  name: string;
  avatarUrl: string | null;
  teacherAvatarUrl: string | null;
  teacherBannerUrl: string | null;
  subscription: { paymentSubscriptionId: string; providerSubscriptionId: string | null; status: 'ACTIVE' | 'CANCEL_PENDING'; purchasedAt: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelRequestedAt: string | null; accessEndsAt: string | null };
  permissions: Record<'agent' | 'questions' | 'flashcards' | 'dailyChallenges' | 'chat' | 'performance' | 'ranking', boolean>;
};
export type EntitlementSnapshot = { studentId: string; generatedAt: string; source: 'REDIS' | 'DATABASE'; monitors: EntitlementMonitor[]; alerts: Array<{ code: string; monitorId: string }> };

const ACTIVE = new Set(['ACTIVE', 'CANCEL_PENDING']);

export class EntitlementService {
  constructor(private readonly repository: EntitlementRepository, private readonly cache: RedisEntitlementCache, private readonly now = () => new Date()) {}

  async getSnapshot(studentId: string): Promise<EntitlementSnapshot> {
    const cached = await this.cache.get<EntitlementSnapshot>(studentId);
    if (cached) return { ...cached, source: 'REDIS' };
    const rows = await this.repository.listForStudent(studentId);
    const grouped = new Map<string, EntitlementMonitor>();
    const alerts: EntitlementSnapshot['alerts'] = [];
    for (const row of rows) {
      if (!ACTIVE.has(row.subscriptionStatus) || !ACTIVE.has(row.itemStatus)) continue;
      if (row.currentPeriodEnd && new Date(row.currentPeriodEnd).getTime() <= this.now().getTime()) continue;
      const existing = grouped.get(row.monitorId);
      if (existing) {
        alerts.push({ code: 'DUPLICATE_PROVIDER_SUBSCRIPTION', monitorId: row.monitorId });
        continue;
      }
      const status = row.subscriptionStatus === 'CANCEL_PENDING' || row.itemStatus === 'CANCEL_PENDING' ? 'CANCEL_PENDING' : 'ACTIVE';
      grouped.set(row.monitorId, {
        ...row,
        name: row.monitorName,
        avatarUrl: row.monitorAvatarUrl,
        teacherAvatarUrl: row.teacherAvatarUrl,
        teacherBannerUrl: row.teacherBannerUrl,
        subscription: { paymentSubscriptionId: row.subscriptionId, providerSubscriptionId: row.providerSubscriptionId, status, purchasedAt: row.purchasedAt, currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd, cancelRequestedAt: row.cancelRequestedAt, accessEndsAt: row.currentPeriodEnd },
        permissions: { agent: true, questions: true, flashcards: true, dailyChallenges: true, chat: true, performance: true, ranking: true },
      });
    }
    const snapshot: EntitlementSnapshot = { studentId, generatedAt: this.now().toISOString(), source: 'DATABASE', monitors: [...grouped.values()], alerts };
    await this.cache.set(studentId, snapshot);
    return snapshot;
  }

  async getAccessibleMonitorIds(studentId: string) { return (await this.getSnapshot(studentId)).monitors.map((monitor) => monitor.monitorId); }
  async hasMonitorAccess(studentId: string, monitorId: string) { return (await this.getSnapshot(studentId)).monitors.some((monitor) => monitor.monitorId === monitorId); }
  async invalidate(studentId: string, reason: string) { await this.cache.invalidate(studentId); console.log('Snapshot de acesso invalidado', { event: 'access.snapshot_invalidated', studentId, reason }); }
}
