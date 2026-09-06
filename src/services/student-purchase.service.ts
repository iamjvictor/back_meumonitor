import crypto from 'node:crypto';
import type { CreatePurchaseInput } from '../models/student-purchase.model.js';

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(event, { event, ...data });
}

type Repo = {
  findStudentByUserId(id: string): Promise<{ id: string } | null>; findPublishedMonitors(ids: string[]): Promise<Array<{ id: string; name: string }>>;
  findActiveSubscriptions(studentId: string, ids: string[]): Promise<Array<{ monitorId: string }>>; findPurchaseByIdempotencyKey(key: string): Promise<any>;
  createPurchase(data: any): Promise<any>; findPurchaseForStudent(id: string, studentId: string): Promise<any>; createPaymentSession(data: any): Promise<any>;
  updatePurchaseCheckoutReference?: (purchaseId: string, reference: string) => Promise<any>;
  findPaymentSessionByTokenHash(hash: string): Promise<any>; consumePaymentSession(id: string): Promise<{ consumed: boolean; session: any }>;
  confirmPurchase(id: string, studentId: string): Promise<any>; listPurchases(id: string): Promise<any>; listActiveSubscriptions(id: string): Promise<any>;
};

export class StudentPurchaseService {
  constructor(private readonly repo: Repo, private readonly config = { simulationEnabled: false, testPriceCents: 1990 }) {}
  async createPurchase(userId: string, input: CreatePurchaseInput, key: string) {
    log('monitor.student_purchase_create_started', { userId, monitorCount: input.monitorIds.length, paymentMethod: input.paymentMethod, hasIdempotencyKey: Boolean(key?.trim()) });
    if (!key?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    log('monitor.student_purchase_idempotency_key_validated', { userId, keyProvided: true });
    if (new Set(input.monitorIds).size !== input.monitorIds.length) throw new Error('DUPLICATE_MONITOR');
    const student = await this.repo.findStudentByUserId(userId); if (!student) throw new Error('STUDENT_NOT_FOUND');
    log('monitor.student_purchase_student_resolved', { userId, studentId: student.id });
    const existing = await this.repo.findPurchaseByIdempotencyKey(key);
    if (existing) {
      if (existing.studentId !== student.id) throw new Error('IDEMPOTENCY_KEY_REUSED');
      log('monitor.student_purchase_idempotency_hit', { userId, purchaseId: existing.id, status: existing.status });
      return existing;
    }
    const monitors = await this.repo.findPublishedMonitors(input.monitorIds);
    log('monitor.student_purchase_monitors_validated', { studentId: student.id, requestedCount: input.monitorIds.length, publishedCount: monitors.length });
    if (monitors.length !== input.monitorIds.length) throw new Error('MONITOR_NOT_PUBLISHED');
    const activeSubscriptions = await this.repo.findActiveSubscriptions(student.id, input.monitorIds);
    log('monitor.student_purchase_active_subscription_check_completed', { studentId: student.id, activeCount: activeSubscriptions.length });
    if (activeSubscriptions.length) throw new Error('ACTIVE_SUBSCRIPTION');
    // Monitor não possui preço persistido: o preço de teste é definido exclusivamente no backend.
    const items = monitors.map((m) => ({ monitorId: m.id, descriptionSnapshot: m.name, unitAmount: this.config.testPriceCents, quantity: 1 }));
    const data = { studentId: student.id, status: 'PENDING', paymentMethod: input.paymentMethod, currency: 'BRL', subtotalAmount: items.length * this.config.testPriceCents, discountAmount: 0, totalAmount: items.length * this.config.testPriceCents, idempotencyKey: key, items: { create: items } };
    log('monitor.student_purchase_pending_payload_prepared', { studentId: student.id, itemCount: items.length, totalAmount: data.totalAmount, status: data.status });
    log('monitor.student_purchase_persist_started', { studentId: student.id, itemCount: items.length, totalAmount: data.totalAmount, currency: data.currency });
    try {
      const purchase = await this.repo.createPurchase(data);
      log('monitor.student_purchase_persist_completed', { studentId: student.id, purchaseId: purchase.id, status: purchase.status, totalAmount: purchase.totalAmount });
      return purchase;
    } catch (e: any) {
      if (e?.code === 'P2002') { const found = await this.repo.findPurchaseByIdempotencyKey(key); if (found) { log('monitor.student_purchase_idempotency_race_resolved', { studentId: student.id, purchaseId: found.id }); return found; } }
      log('monitor.student_purchase_create_failed', { userId, errorCode: e?.code, errorMessage: e?.message });
      throw e;
    }
  }
  async simulatedCheckout(userId: string, purchaseId: string) {
    log('monitor.student_purchase_simulated_checkout_started', { userId, purchaseId, simulationEnabled: this.config.simulationEnabled });
    if (!this.config.simulationEnabled) throw new Error('SIMULATION_DISABLED');
    const student = await this.repo.findStudentByUserId(userId); if (!student) throw new Error('STUDENT_NOT_FOUND');
    const purchase = await this.repo.findPurchaseForStudent(purchaseId, student.id); if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
    log('monitor.student_purchase_checkout_purchase_loaded', { studentId: student.id, purchaseId, status: purchase.status, totalAmount: purchase.totalAmount, currency: purchase.currency });
    if (purchase.status !== 'PENDING') throw new Error('PURCHASE_NOT_PENDING');
    const sessionId = crypto.randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + 600000);
    const paymentSession = await this.repo.createPaymentSession({ purchaseId, studentId: student.id, tokenHash: this.hash(sessionId), amount: purchase.totalAmount, currency: purchase.currency, expiresAt });
    await this.repo.updatePurchaseCheckoutReference?.(purchaseId, `simulated:${paymentSession.id}`);
    log('monitor.student_purchase_checkout_reference_saved', { studentId: student.id, purchaseId, checkoutReference: `simulated:${paymentSession.id}`, checkoutUrl: '/checkout/simulado' });
    log('monitor.student_purchase_simulated_session_created', { studentId: student.id, purchaseId, expiresAt: expiresAt.toISOString(), amount: purchase.totalAmount, currency: purchase.currency, tokenStoredAsHash: true });
    return { sessionId, expiresAt, amount: purchase.totalAmount, currency: purchase.currency, checkoutUrl: '/checkout/simulado', checkoutReference: `simulated:${paymentSession.id}` };
  }
  async simulatedConfirmation(userId: string, purchaseId: string, sessionId: string) {
    log('monitor.student_purchase_simulated_webhook_received', { userId, purchaseId, source: 'SIMULATED_CHECKOUT', sessionProvided: Boolean(sessionId) });
    if (!this.config.simulationEnabled) throw new Error('SIMULATION_DISABLED');
    const student = await this.repo.findStudentByUserId(userId); if (!student) throw new Error('STUDENT_NOT_FOUND');
    const session = await this.repo.findPaymentSessionByTokenHash(this.hash(sessionId));
    log('monitor.student_purchase_simulated_session_validation_completed', { studentId: student.id, purchaseId, valid: Boolean(session && session.purchaseId === purchaseId && session.studentId === student.id) });
    if (!session || session.purchaseId !== purchaseId || session.studentId !== student.id) throw new Error('INVALID_CHECKOUT_SESSION');
    const purchase = await this.repo.findPurchaseForStudent(purchaseId, student.id);
    log('monitor.student_purchase_simulated_payment_validation_completed', { studentId: student.id, purchaseId, amountMatches: Boolean(purchase && purchase.totalAmount === session.amount), currencyMatches: Boolean(purchase && purchase.currency === session.currency) });
    if (!purchase || purchase.totalAmount !== session.amount || purchase.currency !== session.currency) throw new Error('CHECKOUT_AMOUNT_MISMATCH');
    if (session.expiresAt <= new Date()) { log('monitor.student_purchase_simulated_session_expired', { studentId: student.id, purchaseId, expiresAt: session.expiresAt }); throw new Error('SESSION_EXPIRED'); }
    const consumed = await this.repo.consumePaymentSession(session.id);
    log('monitor.student_purchase_simulated_session_consumed', { studentId: student.id, purchaseId, consumed: consumed.consumed });
    if (!consumed.consumed) { if (purchase.status === 'PAID') { log('monitor.student_purchase_simulated_confirmation_idempotent', { studentId: student.id, purchaseId }); return purchase; } throw new Error('INVALID_CHECKOUT_SESSION'); }
    log('monitor.student_purchase_subscription_activation_started', { studentId: student.id, purchaseId, itemCount: purchase.items?.length });
    const confirmed = await this.repo.confirmPurchase(purchaseId, student.id);
    log('monitor.student_purchase_paid_transition_completed', { studentId: student.id, purchaseId, previousStatus: purchase.status, currentStatus: confirmed?.status });
    log('monitor.student_purchase_subscription_activation_completed', { studentId: student.id, purchaseId, status: confirmed?.status });
    return confirmed;
  }
  private hash(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
  async listPurchases(userId: string) { const s = await this.repo.findStudentByUserId(userId); if (!s) throw new Error('STUDENT_NOT_FOUND'); return this.repo.listPurchases(s.id); }
  async listSubscriptions(userId: string) { const s = await this.repo.findStudentByUserId(userId); if (!s) return []; return this.repo.listActiveSubscriptions(s.id); }
}
