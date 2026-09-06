import type { BillingInterval, PaymentProvider } from '../providers/payment-provider.port.js';
import { randomUUID } from 'node:crypto';

type Config = { testPriceCents: number };

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(event, { event, ...data });
}

export class SubscriptionService {
  constructor(private readonly repo: any, private readonly provider: PaymentProvider, private readonly config: Config) {}

  async addMonitor(userId: string, billingSubscriptionId: string, monitorId: string, idempotencyKey?: string) {
    const { student, subscription } = await this.context(userId, billingSubscriptionId);
    const operationKey = idempotencyKey ?? randomUUID();
    const replay = await this.replay(operationKey, subscription.id, student.id, 'ADD', userId, { monitorId });
    if (replay) return replay;
    const monitor = await this.repo.findPublishedMonitor(monitorId);
    if (!monitor) throw new Error('MONITOR_NOT_PUBLISHED');
    const enrollment = await this.repo.findEnrollment(student.id, monitorId);
    if (enrollment?.status === 'ACTIVE') throw new Error('ACTIVE_ENROLLMENT');
    const activeItems = subscription.items.filter((item: any) => item.status === 'ACTIVE');
    const amount = this.total(activeItems.length + 1, subscription.billingInterval as BillingInterval);
    log('monitor.billing_subscription_add_started', { userId, billingSubscriptionId, monitorId, amount });
    try { await this.provider.updateSubscription({ subscriptionId: subscription.providerSubscriptionId, amount, interval: subscription.billingInterval, effectiveAt: 'NOW' }); }
    catch (error) { log('monitor.billing_subscription_add_failed', { userId, billingSubscriptionId, monitorId, stage: 'provider_update', error: error instanceof Error ? error.message : 'unknown' }); throw error; }
    try {
      let item = subscription.items.find((candidate: any) => candidate.monitorId === monitorId);
      if (item) item = await this.repo.updateItem(item.id, { status: 'ACTIVE', removedAt: null, currentPeriodEnd: subscription.currentPeriodEnd });
      else item = await this.repo.createItem({ subscriptionId: subscription.id, monitorId, status: 'ACTIVE', amountBeforeDiscount: this.periodPrice(subscription.billingInterval), discountAmount: 0, finalAmount: this.periodPrice(subscription.billingInterval), currentPeriodEnd: subscription.currentPeriodEnd });
      await this.repo.upsertEnrollment({ studentId: student.id, monitorId, subscriptionItemId: item.id, status: 'ACTIVE', startsAt: new Date(), endsAt: null });
      await this.repo.updateSubscriptionTotals(subscription.id, { subtotalAmount: amount, totalAmount: amount, cancelAtPeriodEnd: false });
      const result = { subscriptionId: subscription.id, status: 'ACTIVE', amount };
      await this.recordChange({ subscriptionId: subscription.id, studentId: student.id, type: enrollment?.status === 'PENDING_REMOVAL' ? 'REACTIVATE' : 'ADD', monitorId, amount, operationKey, metadata: { operation: 'ADD', monitorId, result } });
      return result;
    } catch (error) {
      log('monitor.billing_subscription_add_failed', { userId, billingSubscriptionId, monitorId, stage: 'persistence_reconciliation_required', operationKey, error: error instanceof Error ? error.message : 'unknown' }); throw error;
    }
    log('monitor.billing_subscription_add_completed', { userId, billingSubscriptionId, monitorId, amount });
  }

  async removeMonitor(userId: string, billingSubscriptionId: string, monitorId: string, idempotencyKey?: string) {
    const { student, subscription } = await this.context(userId, billingSubscriptionId);
    const operationKey = idempotencyKey ?? randomUUID();
    const replay = await this.replay(operationKey, subscription.id, student.id, 'REMOVE', userId, { monitorId });
    if (replay) return replay;
    const item = subscription.items.find((candidate: any) => candidate.monitorId === monitorId && candidate.status === 'ACTIVE');
    if (!item) throw new Error('SUBSCRIPTION_ITEM_NOT_FOUND');
    const periodEnd = subscription.currentPeriodEnd;
    const activeCount = subscription.items.filter((candidate: any) => candidate.status === 'ACTIVE' && candidate.monitorId !== monitorId).length;
    const amount = this.total(activeCount, subscription.billingInterval as BillingInterval);
    log('monitor.billing_subscription_remove_started', { userId, billingSubscriptionId, monitorId, effectiveAt: 'PERIOD_END', activeCount });
    try { await this.provider.updateSubscription({ subscriptionId: subscription.providerSubscriptionId, amount, interval: subscription.billingInterval, effectiveAt: 'PERIOD_END' }); if (activeCount === 0) await this.provider.cancelSubscription({ subscriptionId: subscription.providerSubscriptionId, atPeriodEnd: true }); }
    catch (error) { log('monitor.billing_subscription_remove_failed', { userId, billingSubscriptionId, monitorId, stage: 'provider', error: error instanceof Error ? error.message : 'unknown' }); throw error; }
    const result = { subscriptionId: subscription.id, status: 'PENDING_REMOVAL', endsAt: periodEnd };
    try { await this.repo.markItemPendingRemoval(item.id, { status: 'PENDING_REMOVAL', currentPeriodEnd: periodEnd }); await this.repo.markEnrollmentPendingRemoval(student.id, monitorId, { status: 'PENDING_REMOVAL', endsAt: periodEnd }); await this.repo.updateSubscriptionTotals(subscription.id, { subtotalAmount: amount, totalAmount: amount, cancelAtPeriodEnd: activeCount === 0 }); await this.recordChange({ subscriptionId: subscription.id, studentId: student.id, type: 'REMOVE', monitorId, amount, operationKey, metadata: { operation: 'REMOVE', monitorId, result } }); }
    catch (error) { log('monitor.billing_subscription_remove_failed', { userId, billingSubscriptionId, monitorId, stage: 'persistence_reconciliation_required', operationKey, error: error instanceof Error ? error.message : 'unknown' }); throw error; }
    log('monitor.billing_subscription_remove_completed', { userId, billingSubscriptionId, monitorId, status: 'PENDING_REMOVAL', cancelAtPeriodEnd: activeCount === 0 });
    return result;
  }

  async changeInterval(userId: string, billingSubscriptionId: string, interval: BillingInterval, idempotencyKey?: string) {
    if (interval !== 'MONTH' && interval !== 'YEAR') throw new Error('INVALID_BILLING_INTERVAL');
    const { subscription } = await this.context(userId, billingSubscriptionId);
    const operationKey = idempotencyKey ?? randomUUID();
    const replay = await this.replay(operationKey, subscription.id, subscription.studentId, 'INTERVAL_CHANGE', userId, { interval });
    if (replay) return replay;
    const count = subscription.items.filter((item: any) => item.status === 'ACTIVE').length;
    const amount = this.total(count, interval);
    const result = { subscriptionId: subscription.id, interval, amount };
    try { await this.provider.updateSubscription({ subscriptionId: subscription.providerSubscriptionId, amount, interval, effectiveAt: 'NOW' }); await this.repo.updateSubscriptionTotals(subscription.id, { billingInterval: interval, subtotalAmount: amount, totalAmount: amount }); await this.recordChange({ subscriptionId: subscription.id, studentId: subscription.studentId, type: 'INTERVAL_CHANGE', fromInterval: subscription.billingInterval, toInterval: interval, amount, operationKey, metadata: { operation: 'INTERVAL_CHANGE', interval, result } }); }
    catch (error) { log('monitor.billing_subscription_interval_change_failed', { userId, billingSubscriptionId, error: error instanceof Error ? error.message : 'unknown' }); throw error; }
    log('monitor.billing_subscription_interval_changed', { userId, billingSubscriptionId, from: subscription.billingInterval, to: interval, amount });
    return result;
  }

  async cancel(userId: string, billingSubscriptionId: string, idempotencyKey?: string) {
    const { subscription } = await this.context(userId, billingSubscriptionId);
    const operationKey = idempotencyKey ?? randomUUID();
    const replay = await this.replay(operationKey, subscription.id, subscription.studentId, 'CANCEL', userId);
    if (replay) return replay;
    log('monitor.billing_subscription_cancel_started', { userId, billingSubscriptionId });
    const result = { subscriptionId: subscription.id, cancelAtPeriodEnd: true };
    try { await this.provider.cancelSubscription({ subscriptionId: subscription.providerSubscriptionId, atPeriodEnd: true }); await this.repo.updateSubscriptionTotals(subscription.id, { cancelAtPeriodEnd: true }); await this.recordChange({ subscriptionId: subscription.id, studentId: subscription.studentId, type: 'CANCEL', operationKey, metadata: { operation: 'CANCEL', result } }); }
    catch (error) { log('monitor.billing_subscription_cancel_failed', { userId, billingSubscriptionId, error: error instanceof Error ? error.message : 'unknown' }); throw error; }
    log('monitor.billing_subscription_cancel_completed', { userId, billingSubscriptionId, cancelAtPeriodEnd: true });
    return result;
  }

  private async replay(key: string, subscriptionId: string, studentId: string, operation: string, userId: string, expected: Record<string, unknown> = {}) {
    if (!this.repo.findChangeByOperationKey) return null;
    const change = await this.repo.findChangeByOperationKey(key);
    if (!change) return null;
    const metadata = change.metadata as any;
    const sameInput = Object.entries(expected).every(([name, value]) => metadata?.[name] === value);
    if (change.subscriptionId !== subscriptionId || change.studentId !== studentId || metadata?.operation !== operation || !sameInput) {
      log('monitor.billing_subscription_idempotency_conflict', { userId, subscriptionId, operation });
      throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    log('monitor.billing_subscription_idempotency_hit', { userId, subscriptionId, operation });
    if (!metadata?.result) throw new Error('IDEMPOTENCY_REPLAY_UNAVAILABLE');
    return metadata.result;
  }

  private async recordChange(data: Record<string, unknown>) { if (this.repo.createChange) await this.repo.createChange(data); }

  private async context(userId: string, subscriptionId: string) {
    const student = await this.repo.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const subscription = await this.repo.findSubscriptionForStudent(subscriptionId, student.id);
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    return { student, subscription };
  }

  private periodPrice(interval: BillingInterval) { return interval === 'YEAR' ? this.config.testPriceCents * 12 : this.config.testPriceCents; }
  private total(count: number, interval: BillingInterval) { return count * this.periodPrice(interval); }
}
