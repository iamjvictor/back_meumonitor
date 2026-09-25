type SubscriptionItem = {
  id: string;
  monitorId: string;
  status: string;
  priceCentsSnapshot: number;
};

type PaymentSubscription = {
  id: string;
  studentId: string;
  providerSubscriptionId: string | null;
  environment: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  items: SubscriptionItem[];
};

type Repository = {
  findForStudent(subscriptionId: string, studentId: string): Promise<PaymentSubscription | null>;
  findIdempotency?: (studentId: string, operation: string, key: string) => Promise<{ state: string } | null>;
  startIdempotency?: (studentId: string, operation: string, key: string, resourceId: string) => Promise<void>;
  completeIdempotency?: (studentId: string, operation: string, key: string, resourceId: string) => Promise<void>;
  failIdempotency?: (studentId: string, operation: string, key: string) => Promise<void>;
  updateItem(id: string, data: { status: string }): Promise<unknown>;
  updateSubscription(id: string, data: { status?: string; cancelAtPeriodEnd?: boolean }): Promise<unknown>;
  createAudit(data: Record<string, unknown>): Promise<unknown>;
};

type Provider = {
  updateSubscription(input: { subscriptionId: string; amount: number; interval: 'MONTHLY' }): Promise<void>;
  cancelSubscription(input: { subscriptionId: string }): Promise<void>;
};

export class PaymentSubscriptionService {
  constructor(
    private readonly repository: Repository,
    private readonly provider: Provider,
    private readonly invalidateAccess?: (studentId: string, reason: string) => Promise<void>,
  ) {}

  async cancelItem(studentId: string, subscriptionId: string, monitorId: string, actorUserId: string, idempotencyKey?: string) {
    const subscription = await this.repository.findForStudent(subscriptionId, studentId);
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (idempotencyKey && this.repository.findIdempotency) {
      const previous = await this.repository.findIdempotency(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey);
      if (previous?.state === 'COMPLETED') return { subscriptionId, monitorId, status: 'CANCEL_PENDING', endsAt: subscription.currentPeriodEnd?.toISOString() ?? null };
      if (previous?.state === 'IN_PROGRESS') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    }
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'CANCEL_PENDING') throw new Error('SUBSCRIPTION_NOT_ACTIVE');

    const item = subscription.items.find((candidate) => candidate.monitorId === monitorId && candidate.status === 'ACTIVE');
    if (!item) throw new Error('SUBSCRIPTION_ITEM_NOT_FOUND');
    if (!subscription.providerSubscriptionId) throw new Error('PROVIDER_SUBSCRIPTION_NOT_FOUND');

    if (idempotencyKey) await this.repository.startIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey, subscriptionId);

    try {
      const remaining = subscription.items.filter((candidate) => candidate.status === 'ACTIVE' && candidate.monitorId !== monitorId);
      if (remaining.length === 0) {
        await this.provider.cancelSubscription({ subscriptionId: subscription.providerSubscriptionId });
      } else {
        const amount = remaining.reduce((sum, candidate) => sum + candidate.priceCentsSnapshot, 0);
        await this.provider.updateSubscription({ subscriptionId: subscription.providerSubscriptionId, amount, interval: 'MONTHLY' });
      }

      await this.repository.updateItem(item.id, { status: 'CANCEL_PENDING' });
      if (remaining.length === 0) {
        await this.repository.updateSubscription(subscription.id, { status: 'CANCEL_PENDING', cancelAtPeriodEnd: true });
      }
      await this.repository.createAudit({
        actorUserId,
        studentId,
        subscriptionId,
        monitorId,
        reason: 'STUDENT_REQUESTED_ITEM_CANCELLATION',
        endsAt: subscription.currentPeriodEnd?.toISOString() ?? null,
      });
      await this.invalidateAccess?.(studentId, 'STUDENT_REQUESTED_ITEM_CANCELLATION');
      await this.repository.completeIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey ?? '', subscriptionId);
    } catch (error) {
      if (idempotencyKey) await this.repository.failIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey);
      throw error;
    }

    return {
      subscriptionId,
      monitorId,
      status: 'CANCEL_PENDING',
      endsAt: subscription.currentPeriodEnd?.toISOString() ?? null,
    };
  }
}
