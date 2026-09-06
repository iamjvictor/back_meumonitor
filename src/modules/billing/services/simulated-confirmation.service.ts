import crypto from 'node:crypto';
import type { WebhookService } from './webhook.service.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class SimulatedConfirmationService {
  constructor(private readonly repository: any, private readonly webhook: Pick<WebhookService, 'process'>) {}

  async confirm(userId: string, purchaseId: string, sessionId: string) {
    log('monitor.billing_simulated_confirmation_started', { userId, purchaseId, sessionProvided: Boolean(sessionId) });
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const session = await this.repository.findPaymentSessionByTokenHash(sessionTokenHash);
    if (!session || session.purchaseId !== purchaseId || session.studentId !== student.id) throw new Error('INVALID_CHECKOUT_SESSION');
    if (session.expiresAt <= new Date()) throw new Error('SESSION_EXPIRED');
    const purchase = await this.repository.findPurchaseForStudent(purchaseId, student.id);
    if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
    if (purchase.status === 'PAID') return { status: 'PAID', purchaseId, idempotent: true };
    if (purchase.totalAmount !== session.amount || purchase.currency !== session.currency) throw new Error('CHECKOUT_AMOUNT_MISMATCH');
    const consumed = await this.repository.consumePaymentSession(session.id);
    if (!consumed.consumed) throw new Error('INVALID_CHECKOUT_SESSION');
    log('monitor.billing_simulated_confirmation_session_consumed', { userId, purchaseId, sessionRecordId: session.id });
    const result = await this.webhook.process('SIMULATED', {
      providerEventId: `simulated:${session.id}`,
      type: 'checkout.completed',
      purchaseId,
      amount: purchase.totalAmount,
      currency: purchase.currency,
      payload: { source: 'SIMULATED_CHECKOUT', sessionTokenHash },
    });
    const confirmation = { ...result, webhookStatus: result.status, status: 'PAID' };
    log('monitor.billing_simulated_confirmation_completed', { userId, purchaseId, status: confirmation.status, webhookStatus: confirmation.webhookStatus, subscriptionId: confirmation.subscriptionId });
    return confirmation;
  }
}
