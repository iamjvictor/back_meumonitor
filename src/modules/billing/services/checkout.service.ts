import crypto from 'node:crypto';
import type { CreatePurchaseInput } from '../models/checkout.model.js';
import type { PaymentProvider, BillingInterval } from '../providers/payment-provider.port.js';
import { StudentPurchaseService } from '../../../services/student-purchase.service.js';
import type { SimulatedConfirmationService } from './simulated-confirmation.service.js';

type Config = { simulationEnabled: boolean; testPriceCents: number };
type CustomerRepo = { findStudentByUserId(userId: string): Promise<{ id: string; email: string } | null>; upsert(data: { studentId: string; provider: string; providerCustomerId: string }): Promise<unknown> };

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

/** Implementação do checkout agregado; os métodos legados ficam como adapter temporário das rotas existentes. */
export class CheckoutService {
  private readonly legacy: StudentPurchaseService;
  private readonly customerRepo?: CustomerRepo;
  private readonly provider?: PaymentProvider;
  private readonly config: Config;
  constructor(private readonly repo: any, customerRepoOrConfig: CustomerRepo | Config, provider?: PaymentProvider, config?: Config, private readonly simulatedConfirmationService?: SimulatedConfirmationService) {
    if (provider && config) { this.customerRepo = customerRepoOrConfig as CustomerRepo; this.provider = provider; this.config = config; }
    else this.config = customerRepoOrConfig as Config;
    this.legacy = new StudentPurchaseService(repo, this.config);
  }

  async createCheckout(userId: string, input: CreatePurchaseInput & { interval?: BillingInterval }, idempotencyKey: string) {
    log('monitor.billing_checkout_requested', { userId, monitorCount: input.monitorIds.length, hasIdempotencyKey: Boolean(idempotencyKey?.trim()) });
    log('monitor.billing_checkout_started', { userId, monitorCount: input.monitorIds.length, interval: input.interval ?? 'MONTH', hasIdempotencyKey: Boolean(idempotencyKey?.trim()) });
    if (!idempotencyKey?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    if (new Set(input.monitorIds).size !== input.monitorIds.length) throw new Error('DUPLICATE_MONITOR');
    if (!this.customerRepo || !this.provider) throw new Error('BILLING_MODULE_NOT_CONFIGURED');
    const student = await this.customerRepo.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const existing = await this.repo.findPurchaseByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.studentId !== student.id) throw new Error('IDEMPOTENCY_KEY_REUSED');
      if (existing.gatewayCheckoutId) {
        const checkoutId = existing.gatewayCheckoutId.replace(/^simulated:/, '');
        const expiresAt = new Date(Date.now() + 600000);
        const sessionId = crypto.randomBytes(32).toString('hex');
        await this.repo.createPaymentSession({ purchaseId: existing.id, studentId: student.id, tokenHash: crypto.createHash('sha256').update(sessionId).digest('hex'), amount: existing.totalAmount, currency: existing.currency, expiresAt });
        log('monitor.billing_checkout_idempotency_replayed', { userId, studentId: student.id, purchaseId: existing.id, checkoutId, status: existing.status, newSessionCreated: true });
        return this.result(existing, checkoutId, '/checkout/simulado', expiresAt, sessionId);
      }
      throw new Error('CHECKOUT_REFERENCE_MISSING');
    }
    const monitors = await this.repo.findPublishedMonitors(input.monitorIds);
    if (monitors.length !== input.monitorIds.length) throw new Error('MONITOR_NOT_PUBLISHED');
    const active = await this.repo.findActiveSubscriptions(student.id, input.monitorIds);
    if (active.length) throw new Error('ACTIVE_SUBSCRIPTION');
    log('monitor.billing_checkout_validated', { userId, studentId: student.id, monitorCount: monitors.length, interval: input.interval ?? 'MONTH' });
    const unitAmount = this.config.testPriceCents;
    const amount = monitors.length * unitAmount;
    log('monitor.billing_checkout_amount_calculated', { userId, studentId: student.id, itemCount: monitors.length, unitAmount, discountAmount: 0, totalAmount: amount, currency: 'BRL' });
    log('monitor.billing_purchase_creation_started', { userId, studentId: student.id, status: 'PENDING', itemCount: monitors.length, totalAmount: amount });
    let purchase;
    try {
      purchase = await this.repo.createPurchase({ studentId: student.id, status: 'PENDING', paymentMethod: input.paymentMethod, currency: 'BRL', subtotalAmount: amount, discountAmount: 0, totalAmount: amount, idempotencyKey, items: { create: monitors.map((m: any) => ({ monitorId: m.id, descriptionSnapshot: m.name, unitAmount, quantity: 1 })) } });
    } catch (error) {
      log('monitor.billing_purchase_creation_failed', { userId, studentId: student.id, status: 'PENDING', stage: 'database', errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      throw error;
    }
    log('monitor.billing_purchase_created', { userId, studentId: student.id, purchaseId: purchase.id, status: purchase.status, itemCount: monitors.length, totalAmount: amount });
    let customer;
    try {
      customer = await this.provider.getOrCreateCustomer({ studentId: student.id, email: student.email });
      await this.customerRepo.upsert({ studentId: student.id, provider: 'SIMULATED', providerCustomerId: customer.customerId });
    } catch (error) {
      log('monitor.billing_customer_resolution_failed', { userId, studentId: student.id, purchaseId: purchase.id, stage: 'provider_or_database', errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      throw error;
    }
    log('monitor.billing_customer_resolved', { userId, studentId: student.id, provider: 'SIMULATED', customerResolved: true });
    log('monitor.billing_checkout_url_requested', { userId, studentId: student.id, purchaseId: purchase.id, provider: 'SIMULATED', amount, interval: input.interval ?? 'MONTH' });
    let checkout;
    try {
      checkout = await this.provider.createCheckout({ customerId: customer.customerId, purchaseId: purchase.id, amount, currency: 'BRL', interval: input.interval ?? 'MONTH' });
    } catch (error) {
      log('monitor.billing_checkout_url_failed', { userId, studentId: student.id, purchaseId: purchase.id, provider: 'SIMULATED', errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      throw error;
    }
    log('monitor.billing_checkout_url_created', { userId, studentId: student.id, purchaseId: purchase.id, checkoutId: checkout.checkoutId, expiresAt: checkout.expiresAt, status: 'PENDING' });
    const sessionId = crypto.randomBytes(32).toString('hex');
    try {
      await this.repo.createPaymentSession({ purchaseId: purchase.id, studentId: student.id, tokenHash: crypto.createHash('sha256').update(sessionId).digest('hex'), amount, currency: 'BRL', expiresAt: checkout.expiresAt });
      await this.repo.updatePurchaseCheckoutReference(purchase.id, `simulated:${checkout.checkoutId}`);
    } catch (error) {
      log('monitor.billing_checkout_persistence_failed', { userId, studentId: student.id, purchaseId: purchase.id, stage: 'payment_session_or_checkout_reference', errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      throw error;
    }
    log('monitor.billing_checkout_completed', { userId, studentId: student.id, purchaseId: purchase.id, checkoutId: checkout.checkoutId, amount, currency: 'BRL', status: 'PENDING' });
    return { purchaseId: purchase.id, status: purchase.status, checkoutUrl: checkout.checkoutUrl, checkoutId: checkout.checkoutId, amount, currency: 'BRL', expiresAt: checkout.expiresAt, sessionId };
  }

  private result(purchase: any, checkoutId: string, checkoutUrl: string, expiresAt: Date, sessionId?: string) { return { purchaseId: purchase.id, status: purchase.status, checkoutUrl, checkoutId, amount: purchase.totalAmount, currency: purchase.currency, expiresAt, ...(sessionId ? { sessionId } : {}) }; }
  createPurchase(userId: string, input: CreatePurchaseInput, key: string): Promise<any> {
    if (!this.provider) return this.legacy.createPurchase(userId, input, key);
    return this.createCheckout(userId, input, key);
  }
  simulatedCheckout(userId: string, purchaseId: string) { return this.legacy.simulatedCheckout(userId, purchaseId); }
  simulatedConfirmation(userId: string, purchaseId: string, sessionId: string) { return this.simulatedConfirmationService?.confirm(userId, purchaseId, sessionId) ?? this.legacy.simulatedConfirmation(userId, purchaseId, sessionId); }
  listPurchases(userId: string) { return this.legacy.listPurchases(userId); }
  listSubscriptions(userId: string) { return this.legacy.listSubscriptions(userId); }
}
