import { StudentPurchaseRepository } from '../../../repositories/student-purchase.repository.js';
import { prisma } from '../../../lib/prisma.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

/** Adaptador de persistência do checkout; mantém a implementação existente durante a migração. */
export class PurchaseRepository extends StudentPurchaseRepository {
  findPurchaseForWebhook(purchaseId: string) {
    return prisma.studentPurchase.findUnique({ where: { id: purchaseId }, include: { items: true } });
  }

  async confirmAggregatedPurchase(input: { provider: string; event: any; purchase: any }) {
    const { event, purchase } = input;
    log('monitor.billing_purchase_approval_transaction_started', { provider: input.provider, purchaseId: purchase.id, itemCount: purchase.items.length });
    return prisma.$transaction(async (tx) => {
      const current = await tx.studentPurchase.findUnique({ where: { id: purchase.id }, include: { items: true } });
      if (!current) throw new Error('PURCHASE_NOT_FOUND');
      if (current.status === 'PAID') return { purchaseId: current.id, status: 'PAID', subscriptionCount: 1, itemCount: current.items.length, enrollmentCount: current.items.length };
      const customer = event.customerId
        ? await tx.stripeCustomer.findUnique({ where: { providerCustomerId: event.customerId } })
        : await tx.stripeCustomer.findUnique({ where: { studentId: current.studentId } });
      if (!customer || customer.studentId !== current.studentId) throw new Error('CUSTOMER_STUDENT_MISMATCH');
      log('monitor.billing_customer_verified_for_webhook', { provider: input.provider, purchaseId: current.id, studentId: current.studentId });
      const now = new Date();
      const periodEnd = new Date(now); periodEnd.setMonth(periodEnd.getMonth() + 1);
      const providerSubscriptionId = event.subscriptionId ?? `${input.provider.toLowerCase()}:${current.id}`;
      const subscription = await tx.billingSubscription.upsert({
        where: { providerSubscriptionId },
        create: { studentId: current.studentId, customerId: customer.id, providerSubscriptionId, status: 'ACTIVE', billingInterval: 'MONTH', currency: current.currency, subtotalAmount: current.subtotalAmount, discountAmount: current.discountAmount, totalAmount: current.totalAmount, currentPeriodStart: now, currentPeriodEnd: periodEnd },
        update: { status: 'ACTIVE', totalAmount: current.totalAmount, currentPeriodEnd: periodEnd, cancelledAt: null, cancelAtPeriodEnd: false },
      });
      log('monitor.billing_subscription_persisted', { provider: input.provider, purchaseId: current.id, subscriptionId: subscription.id, providerSubscriptionId: subscription.providerSubscriptionId, status: subscription.status });
      let enrollmentCount = 0;
      for (const item of current.items) {
        const subItem = await tx.billingSubscriptionItem.upsert({
          where: { subscriptionId_monitorId: { subscriptionId: subscription.id, monitorId: item.monitorId } },
          create: { subscriptionId: subscription.id, monitorId: item.monitorId, status: 'ACTIVE', amountBeforeDiscount: item.unitAmount, discountAmount: 0, finalAmount: item.unitAmount, currentPeriodEnd: periodEnd },
          update: { status: 'ACTIVE', removedAt: null, currentPeriodEnd: periodEnd },
        });
        await tx.studentEnrollment.upsert({
          where: { studentId_monitorId: { studentId: current.studentId, monitorId: item.monitorId } },
          create: { studentId: current.studentId, monitorId: item.monitorId, subscriptionItemId: subItem.id, status: 'ACTIVE', startsAt: now },
          update: { subscriptionItemId: subItem.id, status: 'ACTIVE', endsAt: null },
        });
        // Projeção temporária para os consumidores legados que ainda leem
        // student_subscriptions. A assinatura agregada acima permanece a
        // fonte principal do billing.
        await tx.studentSubscription.upsert({
          where: { studentId_monitorId: { studentId: current.studentId, monitorId: item.monitorId } },
          create: { studentId: current.studentId, monitorId: item.monitorId, status: 'active', purchaseId: current.id, lastPaymentId: current.id, startsAt: now, amountPaid: item.unitAmount / 100 },
          update: { status: 'active', purchaseId: current.id, lastPaymentId: current.id, startsAt: now, amountPaid: item.unitAmount / 100 },
        });
        log('monitor.billing_legacy_subscription_projection_updated', { provider: input.provider, purchaseId: current.id, studentId: current.studentId, monitorId: item.monitorId, status: 'active' });
        enrollmentCount++;
      }
      log('monitor.billing_subscription_items_and_enrollments_persisted', { provider: input.provider, purchaseId: current.id, subscriptionId: subscription.id, itemCount: current.items.length, enrollmentCount });
      await tx.studentPurchase.update({ where: { id: current.id }, data: { status: 'PAID', paidAt: now, gateway: input.provider, gatewayPaymentId: event.providerEventId } });
      log('monitor.billing_purchase_status_updated', { provider: input.provider, purchaseId: current.id, previousStatus: current.status, status: 'PAID', paidAt: now });
      return { purchaseId: current.id, status: 'PAID', subscriptionId: subscription.id, subscriptionCount: 1, itemCount: current.items.length, enrollmentCount };
    });
  }
}
