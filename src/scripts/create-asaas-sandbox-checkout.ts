import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createPaymentsModule } from '../modules/payments/payments.module.js';
import { getAsaasBaseUrl } from '../modules/payments/infrastructure/providers/asaas/asaas.config.js';

if (env.ASAAS_ENV !== 'sandbox') {
  throw new Error('Este script só pode ser executado com ASAAS_ENV=sandbox.');
}
if (!env.ASAAS_API_KEY) {
  throw new Error('Defina ASAAS_API_KEY para gerar o Checkout Sandbox.');
}

const monitorIdFromArgument = process.argv[2];
const monitor = monitorIdFromArgument
  ? await prisma.monitor.findFirst({ where: { id: monitorIdFromArgument, status: 'PUBLISHED' }, select: { id: true, name: true } })
  : await prisma.monitor.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });

if (!monitor) {
  throw new Error('Nenhum monitor publicado foi encontrado. Informe um monitorId publicado como argumento.');
}

const runId = randomUUID();
const testStudent = await prisma.student.create({
  data: {
    userId: randomUUID(),
    fullName: `Checkout Sandbox ${runId.slice(0, 8)}`,
    email: `checkout-sandbox+${runId}@meumonitorai.test`,
    role: 'student',
    status: 'active',
  },
  select: { id: true, userId: true, email: true },
});

const returnBaseUrl = env.PAYMENTS_RETURN_BASE_URL ?? env.PUBLIC_FRONT_URL;
if (!returnBaseUrl) {
  throw new Error('Defina PUBLIC_FRONT_URL ou PAYMENTS_RETURN_BASE_URL para receber o retorno do Checkout.');
}

const payments = createPaymentsModule({
  apiKey: env.ASAAS_API_KEY,
  baseUrl: getAsaasBaseUrl('sandbox'),
  environment: 'sandbox',
  timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS,
  returnBaseUrl,
});

console.log('Gerando Checkout Sandbox com aluno de teste', {
  event: 'payments.sandbox_checkout_generation_started',
  monitorId: monitor.id,
  monitorName: monitor.name,
  studentId: testStudent.id,
  testStudentEmail: testStudent.email,
});

const checkout = await payments.createCheckout.execute(testStudent.userId, {
  monitorId: monitor.id,
  idempotencyKey: randomUUID(),
  returnBaseUrl,
});

console.log('Checkout Sandbox criado', {
  event: 'payments.sandbox_checkout_generation_completed',
  checkoutUrl: checkout.checkoutUrl,
  orderId: checkout.orderId,
  subscriptionId: checkout.subscriptionId,
  monitorId: monitor.id,
  studentId: testStudent.id,
  testStudentEmail: testStudent.email,
});

if (checkout.checkoutUrl) console.log(`\nAbra no navegador:\n${checkout.checkoutUrl}`);

