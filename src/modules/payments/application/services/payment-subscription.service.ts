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
  findIdempotency?: (studentId: string, operation: string, key: string) => Promise<{ state: string; resourceId?: string | null } | null>;
  startIdempotency?: (studentId: string, operation: string, key: string, resourceId: string) => Promise<boolean | void>;
  restartFailedIdempotency?: (studentId: string, operation: string, key: string) => Promise<boolean>;
  markProviderCancellationConfirmed?: (studentId: string, operation: string, key: string) => Promise<void>;
  failIdempotency?: (studentId: string, operation: string, key: string) => Promise<void>;
  finalizeCancellation(input: {
    itemId: string;
    studentId: string;
    subscriptionId: string;
    monitorId: string;
    actorUserId: string;
    cancelEntireSubscription: boolean;
    endsAt: string | null;
    idempotencyKey?: string;
  }): Promise<void>;
};

type Provider = {
  updateSubscription(input: { subscriptionId: string; amount: number; interval: 'MONTHLY' }): Promise<void>;
  cancelSubscription(input: { subscriptionId: string }): Promise<void>;
};

export class PaymentSubscriptionProviderError extends Error {
  constructor() {
    super('PAYMENT_PROVIDER_ERROR');
  }
}

export class PaymentSubscriptionReconciliationError extends Error {
  constructor() {
    super('CANCELLATION_RECONCILIATION_PENDING');
  }
}

export class PaymentSubscriptionService {
  constructor(
    private readonly repository: Repository,
    private readonly provider: Provider,
    private readonly invalidateAccess?: (studentId: string, reason: string) => Promise<void>,
  ) {}

  async cancelItem(studentId: string, subscriptionId: string, monitorId: string, actorUserId: string, idempotencyKey?: string) {
    const subscription = await this.repository.findForStudent(subscriptionId, studentId);
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    let providerAlreadyConfirmed = false;
    const previous = idempotencyKey && this.repository.findIdempotency
      ? await this.repository.findIdempotency(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey)
      : null;
    if (previous?.resourceId && previous.resourceId !== subscriptionId) throw new Error('IDEMPOTENCY_KEY_REUSED');
    if (previous?.state === 'COMPLETED') return { subscriptionId, monitorId, status: 'CANCEL_PENDING', endsAt: subscription.currentPeriodEnd?.toISOString() ?? null };
    if (previous?.state === 'IN_PROGRESS') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (previous?.state === 'PROVIDER_CONFIRMED') providerAlreadyConfirmed = true;
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'CANCEL_PENDING') throw new Error('SUBSCRIPTION_NOT_ACTIVE');

    const item = subscription.items.find((candidate) => candidate.monitorId === monitorId && candidate.status === 'ACTIVE');
    if (!item) throw new Error('SUBSCRIPTION_ITEM_NOT_FOUND');
    if (!subscription.providerSubscriptionId) throw new Error('PROVIDER_SUBSCRIPTION_NOT_FOUND');

    if (idempotencyKey && this.repository.findIdempotency) {
      if (previous?.state === 'FAILED') {
        const restarted = await this.repository.restartFailedIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey);
        if (!restarted) throw new Error('IDEMPOTENCY_IN_PROGRESS');
      } else if (!providerAlreadyConfirmed) {
        const started = await this.repository.startIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey, subscriptionId);
        if (started === false) throw new Error('IDEMPOTENCY_IN_PROGRESS');
      }
    }

    const remaining = subscription.items.filter((candidate) => candidate.status === 'ACTIVE' && candidate.monitorId !== monitorId);
    const cancelEntireSubscription = remaining.length === 0;
    if (!providerAlreadyConfirmed) {
      try {
        console.info('Cancelamento de assinatura enviado ao provedor', { event: 'payments.subscription_cancellation_provider_started', studentId, subscriptionId, monitorId, cancelEntireSubscription });
        if (cancelEntireSubscription) {
          await this.provider.cancelSubscription({ subscriptionId: subscription.providerSubscriptionId });
        } else {
          const amount = remaining.reduce((sum, candidate) => sum + candidate.priceCentsSnapshot, 0);
          await this.provider.updateSubscription({ subscriptionId: subscription.providerSubscriptionId, amount, interval: 'MONTHLY' });
        }
        if (idempotencyKey) {
          try {
            await this.repository.markProviderCancellationConfirmed?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey);
          } catch (error) {
            console.error('Falha ao registrar confirmação do provedor para cancelamento', {
              event: 'payments.subscription_cancellation_confirmation_persistence_failed',
              studentId,
              subscriptionId,
              monitorId,
              errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
            });
            throw new PaymentSubscriptionReconciliationError();
          }
        }
        console.info('Cancelamento de assinatura confirmado pelo provedor', { event: 'payments.subscription_cancellation_provider_confirmed', studentId, subscriptionId, monitorId, cancelEntireSubscription });
      } catch (error) {
        if (!(error instanceof PaymentSubscriptionReconciliationError) && idempotencyKey) {
          await this.repository.failIdempotency?.(studentId, 'CANCEL_SUBSCRIPTION_ITEM', idempotencyKey);
        }
        console.error('Falha do provedor ao cancelar item de assinatura', {
          event: 'payments.subscription_cancellation_provider_failed',
          studentId,
          subscriptionId,
          monitorId,
          errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        });
        if (error instanceof PaymentSubscriptionReconciliationError) throw error;
        throw new PaymentSubscriptionProviderError();
      }
    }

    try {
      await this.repository.finalizeCancellation({
        itemId: item.id,
        studentId,
        subscriptionId,
        monitorId,
        actorUserId,
        cancelEntireSubscription,
        endsAt: subscription.currentPeriodEnd?.toISOString() ?? null,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      console.info('Cancelamento de assinatura persistido localmente', { event: 'payments.subscription_cancellation_persisted', studentId, subscriptionId, monitorId, cancelEntireSubscription });
    } catch (error) {
      console.error('Falha ao persistir cancelamento já confirmado pelo provedor', {
        event: 'payments.subscription_cancellation_persistence_failed',
        studentId,
        subscriptionId,
        monitorId,
        errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
      throw new PaymentSubscriptionReconciliationError();
    }

    await this.invalidateAccess?.(studentId, 'STUDENT_REQUESTED_ITEM_CANCELLATION');

    return {
      subscriptionId,
      monitorId,
      status: 'CANCEL_PENDING',
      endsAt: subscription.currentPeriodEnd?.toISOString() ?? null,
    };
  }
}
