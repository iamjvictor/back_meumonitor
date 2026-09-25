import { createHash, randomUUID } from 'node:crypto';
import type { HostedCheckoutResult, PaymentProvider } from '../../domain/ports/payment-provider.port.js';
import type { CheckoutIntent, CreateCheckoutRepository } from '../../infrastructure/persistence/payment-checkout.repository.js';

export class CheckoutStudentNotFoundError extends Error {}
export class CheckoutStudentRoleError extends Error {}
export class CheckoutMonitorNotFoundError extends Error {}
export class CheckoutIdempotencyKeyRequiredError extends Error {}
export class CheckoutIdempotencyKeyReusedError extends Error {}
export class CheckoutPendingError extends Error {}

// Temporary Sandbox override. Keep the monitor/catalog price unchanged while
// making the local order and provider checkout agree on the one-cent test value.
export const TEMPORARY_CHECKOUT_PRICE_OVERRIDE_CENTS = 1;

export type CreateCheckoutInput = { monitorId: string; idempotencyKey: string; returnBaseUrl: string };

export class CreateCheckoutUseCase {
  constructor(private readonly repository: CreateCheckoutRepository, private readonly provider: PaymentProvider) {}

  async execute(userId: string, input: CreateCheckoutInput) {
    const key = input.idempotencyKey.trim();
    if (!key) throw new CheckoutIdempotencyKeyRequiredError();

    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new CheckoutStudentNotFoundError();
    if (student.role.toLowerCase() !== 'student') throw new CheckoutStudentRoleError();

    const fingerprint = createHash('sha256').update(JSON.stringify({ monitorId: input.monitorId })).digest('hex');
    const existing = await this.repository.findIdempotency(student.id, key);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new CheckoutIdempotencyKeyReusedError();
      if (existing.state === 'FAILED') {
        console.log('Tentativa anterior de checkout falhou; permitindo nova tentativa', {
          event: 'payments.checkout_failed_retry_allowed',
          studentId: student.id,
          monitorId: input.monitorId,
          idempotencyKey: key,
        });
        await this.repository.resetFailedIdempotency(student.id, key);
        console.log('Chave de idempotência FAILED removida para retry', {
          event: 'payments.checkout_failed_retry_reset_completed',
          studentId: student.id,
          monitorId: input.monitorId,
        });
      } else if (existing.order) {
        if (!existing.checkout?.checkoutUrl) throw new CheckoutPendingError();
        return formatResult(existing.order, existing.checkout);
      }
    }

    console.log('Buscando monitor publicado para checkout', {
      event: 'payments.checkout_monitor_lookup_started',
      studentId: student.id,
      monitorId: input.monitorId,
    });
    const monitor = await this.repository.findPublishedMonitor(input.monitorId);
    console.log('Busca de monitor para checkout concluída', {
      event: 'payments.checkout_monitor_lookup_completed',
      studentId: student.id,
      monitorId: input.monitorId,
      found: Boolean(monitor),
    });
    if (!monitor) throw new CheckoutMonitorNotFoundError();
    const checkoutMonitor = { ...monitor, priceCents: TEMPORARY_CHECKOUT_PRICE_OVERRIDE_CENTS };
    console.warn('Override temporário de preço aplicado ao checkout', {
      event: 'payments.checkout_price_override_applied',
      studentId: student.id,
      monitorId: monitor.id,
      catalogPriceCents: monitor.priceCents,
      checkoutPriceCents: checkoutMonitor.priceCents,
    });
    console.log('Criando intenção local de checkout', {
      event: 'payments.checkout_intent_creation_started',
      studentId: student.id,
      monitorId: monitor.id,
    });
    const intent = await this.repository.createIntent({
      studentId: student.id,
      monitor: checkoutMonitor,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    console.log('Intenção local de checkout criada', {
      event: 'payments.checkout_intent_creation_completed',
      studentId: student.id,
      monitorId: monitor.id,
      orderId: intent.order.id,
      subscriptionId: intent.order.subscriptionId,
    });

    const callbackBase = input.returnBaseUrl.replace(/\/$/, '');
    let checkout: HostedCheckoutResult;
    try {
      checkout = await this.provider.createHostedCheckout({
        externalReference: intent.order.id,
        monitorName: checkoutMonitor.name,
        description: 'Assinatura mensal do monitor',
        amountCents: checkoutMonitor.priceCents,
        successUrl: `${callbackBase}/areadoaluno?orderId=${intent.order.id}&status=success`,
        cancelUrl: `${callbackBase}/areadoaluno?orderId=${intent.order.id}&status=cancelled`,
        expiredUrl: `${callbackBase}/areadoaluno?orderId=${intent.order.id}&status=expired`,
        nextDueDate: new Date().toISOString().slice(0, 10),
        splits: intent.payout.walletId && intent.payout.percentage !== '0.0000'
          ? [{ walletId: intent.payout.walletId, percentage: intent.payout.percentage }]
          : [],
      });
    } catch (error) {
      await this.repository.markCheckoutCreationFailed(intent.order.id, error instanceof Error ? error.message : 'CHECKOUT_CREATION_FAILED');
      throw error;
    }

    try {
      const saved = await this.repository.saveCheckout(intent.order.id, checkout);
      return formatResult(saved.order, saved.checkout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Falha ao persistir checkout depois da criação no provedor', {
        event: 'payments.checkout_persistence_failed',
        orderId: intent.order.id,
        providerCheckoutId: checkout.providerCheckoutId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: message,
      });
      try {
        await this.repository.markCheckoutCreationFailed(intent.order.id, message);
      } catch (markError) {
        console.error('Falha ao marcar pedido com erro de persistência do checkout', {
          event: 'payments.checkout_persistence_failure_mark_failed',
          orderId: intent.order.id,
          errorType: markError instanceof Error ? markError.name : 'UnknownError',
          errorMessage: markError instanceof Error ? markError.message : String(markError),
        });
      }
      throw error;
    }
  }
}

function formatResult(order: CheckoutIntent['order'], checkout: CheckoutIntent['checkout']) {
  return {
    orderId: order.id,
    subscriptionId: order.subscriptionId,
    status: order.status,
    checkoutUrl: checkout?.checkoutUrl ?? null,
    amountCents: order.amountCents,
    currency: 'BRL',
    expiresAt: checkout?.expiresAt ?? null,
  };
}
