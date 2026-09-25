import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const webhookUrl = env.ASAAS_WEBHOOK_URL
  ?? (env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/asaas` : undefined);

if (!webhookUrl) throw new Error('Defina ASAAS_WEBHOOK_URL ou PUBLIC_API_URL antes de testar o webhook.');
if (!env.ASAAS_WEBHOOK_AUTH_TOKEN) throw new Error('Defina ASAAS_WEBHOOK_AUTH_TOKEN antes de testar o webhook.');

const useOriginalEventId = process.argv.includes('--original-event-id');
const providerEventId = useOriginalEventId
  ? 'evt_05b708f961d739ea7eba7e4db318f621&20111812'
  : `test_payment_created_${randomUUID()}`;

// Reprodução do payload recebido do Asaas. O token de cartão é sintético:
// não é usado pelo backend e não deve ser salvo em código de teste.
const payload = {
  id: providerEventId,
  event: 'PAYMENT_CREATED',
  dateCreated: '2026-09-23 21:30:09',
  account: { id: 'ab23406e-9135-4151-b643-0e3323596a4a', ownerId: null },
  payment: {
    object: 'payment', id: 'pay_idyxnm494834r91i', dateCreated: '2026-09-23', customer: 'cus_000009214020',
    subscription: 'sub_0y9gcrnc6ag7qehj', checkoutSession: 'b87c4c9f-5e90-4cb4-8029-be993723d358', paymentLink: null,
    value: 29.9, netValue: 28.82, originalValue: null, interestValue: null, description: null, billingType: 'CREDIT_CARD', confirmedDate: null,
    creditCard: { creditCardNumber: '4444', creditCardBrand: 'VISA', creditCardToken: 'test-token-not-a-real-card-token' },
    pixTransaction: null, status: 'PENDING', dueDate: '2026-10-23', originalDueDate: '2026-10-23', paymentDate: null,
    clientPaymentDate: null, installmentNumber: null, invoiceUrl: 'https://sandbox.asaas.com/i/idyxnm494834r91i', invoiceNumber: '18157038',
    externalReference: null, deleted: false, anticipated: false, anticipable: false, creditDate: null, estimatedCreditDate: null,
    transactionReceiptUrl: null, nossoNumero: null, bankSlipUrl: null, lastInvoiceViewedDate: null, lastBankSlipViewedDate: null,
    discount: { value: 0, limitDate: null, dueDateLimitDays: 0, type: 'FIXED' }, fine: { value: 0, type: 'FIXED' }, interest: { value: 0, type: 'PERCENTAGE' },
    split: [{ id: '65d680cb-11da-44ee-b521-8149e7ea64dc', walletId: '57219b47-e6f9-44a9-a7b9-28e86f7f7a9a', fixedValue: null, percentualValue: 50, totalValue: 14.41, cancellationReason: null, status: 'PENDING', externalReference: null, description: null }],
    postalService: false, escrow: null, refunds: null,
  },
};

console.log('Enviando simulação de PAYMENT_CREATED ao webhook público', {
  event: 'payments.webhook_test_started', webhookUrl, providerEventId, providerAccountId: payload.account.id, usingOriginalEventId: useOriginalEventId,
});

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json', 'asaas-access-token': env.ASAAS_WEBHOOK_AUTH_TOKEN },
  body: JSON.stringify(payload),
});
const responseBody = await response.text();
console.log('Resposta da simulação de webhook', { event: 'payments.webhook_test_completed', status: response.status, ok: response.ok, responseBody });
if (!response.ok) process.exitCode = 1;
