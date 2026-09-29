import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { ProcessPaymentWebhookUseCase } from '../modules/payments/application/commands/process-webhook.use-case.js';
import { PaymentEventRepository } from '../modules/payments/infrastructure/persistence/payment-event.repository.js';
import { PrismaPaymentWebhookRepository } from '../modules/payments/infrastructure/persistence/prisma-webhook.repository.js';

const eventId = process.argv[2]?.trim();
if (!eventId) throw new Error('Uso: npm run payments:process-webhook-event -- <eventId>');

const inbox = new PrismaPaymentWebhookRepository(env.ASAAS_ENV.toUpperCase());
const processor = new ProcessPaymentWebhookUseCase(inbox, undefined, new PaymentEventRepository());
const result = await processor.execute(eventId);

console.log(JSON.stringify({ eventId, result }, null, 2));
await prisma.$disconnect();
