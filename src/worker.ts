import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { DOCUMENT_QUEUE_NAME, type DocumentJob } from './queues/document.queue.js';
import { markDocumentFailed } from './repositories/document-worker.repository.js';
import { DocumentWorkerService } from './worker/services/document-worker.service.js';
import { startDailyChallengeScheduler } from './modules/daily_challgens/services/daily-challenge-scheduler.service.js';
import { WEEKLY_SIMULATION_QUEUE_NAME, type WeeklySimulationJob } from './queues/weekly-simulation.queue.js';
import { WeeklySimulationWorkerService } from './modules/weekly-simulations/services/weekly-simulation-worker.service.js';
import { PAYMENT_WEBHOOK_QUEUE_NAME, paymentWebhookQueueConnection, type PaymentWebhookJob } from './modules/payments/jobs/payment-webhook.queue.js';
import { PrismaPaymentWebhookRepository } from './modules/payments/infrastructure/persistence/prisma-webhook.repository.js';
import { ProcessPaymentWebhookUseCase } from './modules/payments/application/commands/process-webhook.use-case.js';
import { PaymentWebhookRecoveryJob } from './modules/payments/jobs/payment-recovery.job.js';
import { PaymentAccountRepository } from './modules/payments/infrastructure/persistence/payment-account.repository.js';
import { PaymentEventRepository } from './modules/payments/infrastructure/persistence/payment-event.repository.js';
import { startWorkerHeartbeat } from './health/worker-health.js';
import { loadQuestionGenerationEnumState } from './worker/services/worker-database-bootstrap.js';

const questionGenerationEnumState = await loadQuestionGenerationEnumState(() => prisma.$queryRaw<Array<{ hasCorrection: boolean; hasNormalization: boolean }>>`
  SELECT EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'QuestionAiGenerationType'
      AND enum_value.enumlabel = 'CORRECTION'
  ) AS "hasCorrection",
  EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'QuestionAiGenerationType'
      AND enum_value.enumlabel = 'NORMALIZATION'
  ) AS "hasNormalization"
`);

if (!questionGenerationEnumState?.hasCorrection || !questionGenerationEnumState.hasNormalization) {
  throw new Error('Migration obrigatoria ausente: QuestionAiGenerationType.CORRECTION/NORMALIZATION. Execute npx prisma migrate deploy antes de iniciar o worker.');
}

const redisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const stopWorkerHeartbeat = startWorkerHeartbeat(redisConnection);
const workerService = new DocumentWorkerService();
const dailyChallengeScheduler = startDailyChallengeScheduler();
const weeklySimulationWorkerService = new WeeklySimulationWorkerService();
const paymentWebhookRepository = new PrismaPaymentWebhookRepository(env.ASAAS_ENV.toUpperCase());
const paymentWebhookRecovery = new PaymentWebhookRecoveryJob(paymentWebhookRepository);
const paymentAccountRepository = new PaymentAccountRepository();
const paymentEventRepository = new PaymentEventRepository();
const processPaymentWebhookWithAccounts = new ProcessPaymentWebhookUseCase(paymentWebhookRepository, paymentAccountRepository, paymentEventRepository);
const paymentWebhookRecoveryTimer = setInterval(() => void paymentWebhookRecovery.run(), 60_000);
void paymentWebhookRecovery.run();

const worker = new Worker<DocumentJob>(
  DOCUMENT_QUEUE_NAME,
  async (job) => workerService.process(job.data.documentId, {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  }),
  { connection: redisConnection, concurrency: 2 },
);

const weeklySimulationWorker = new Worker<WeeklySimulationJob>(
  WEEKLY_SIMULATION_QUEUE_NAME,
  async (job) => weeklySimulationWorkerService.process(job.data.simulationId),
  { connection: redisConnection, concurrency: 2 },
);

const paymentWebhookWorker = new Worker<PaymentWebhookJob>(
  PAYMENT_WEBHOOK_QUEUE_NAME,
  async (job) => processPaymentWebhookWithAccounts.execute(job.data.eventId),
  { connection: paymentWebhookQueueConnection, concurrency: 4 },
);

weeklySimulationWorker.on('active', (job) => console.info('[weekly-simulation]', { event: 'weekly_simulation.worker_job_active', jobId: job.id, simulationId: job.data.simulationId }));
weeklySimulationWorker.on('stalled', (jobId) => console.warn('[weekly-simulation]', { event: 'weekly_simulation.worker_job_stalled', jobId }));

worker.on('ready', () => {
  console.log('Worker de documentos conectado ao Redis', {
    event: 'monitor.document_worker_ready',
    queue: DOCUMENT_QUEUE_NAME,
    concurrency: 2,
  });
});

worker.on('completed', (job) => {
  console.log('Job de documento concluido', {
    event: 'monitor.document_job_completed',
    jobId: job.id,
    documentId: job.data.documentId,
  });
});

worker.on('failed', (job, error) => {
  console.log('Job de documento falhou', {
    event: 'monitor.document_job_failed',
    jobId: job?.id,
    documentId: job?.data.documentId,
    attemptsMade: job?.attemptsMade,
    error,
  });

  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    void markDocumentFailed(job.data.documentId, error.message);
  }
});

worker.on('error', (error) => {
  console.log('Erro no worker de documentos', { event: 'monitor.document_worker_error', error });
});

weeklySimulationWorker.on('ready', () => {
  console.log('Worker de simulados semanais conectado ao Redis', { event: 'monitor.weekly_simulation_worker_ready', queue: WEEKLY_SIMULATION_QUEUE_NAME, concurrency: 2 });
});

weeklySimulationWorker.on('completed', (job) => {
  console.log('Job de simulado semanal concluído', { event: 'monitor.weekly_simulation_job_completed', jobId: job.id, simulationId: job.data.simulationId });
});

weeklySimulationWorker.on('failed', (job, error) => {
  console.log('Job de simulado semanal falhou', { event: 'monitor.weekly_simulation_job_failed', jobId: job?.id, simulationId: job?.data.simulationId, attemptsMade: job?.attemptsMade, error: error.message });
});

weeklySimulationWorker.on('error', (error) => {
  console.log('Erro no worker de simulados semanais', { event: 'monitor.weekly_simulation_worker_error', error: error.message });
});

paymentWebhookWorker.on('ready', () => console.log('Worker de webhooks de pagamentos conectado ao Redis', { event: 'payments.webhook_worker_ready', queue: PAYMENT_WEBHOOK_QUEUE_NAME }));
paymentWebhookWorker.on('active', (job) => console.log('Job de webhook Asaas iniciado', { event: 'payments.webhook_job_active', jobId: job.id, eventId: job.data.eventId }));
paymentWebhookWorker.on('completed', (job, result) => console.log('Job de webhook Asaas concluído', { event: 'payments.webhook_job_completed', jobId: job.id, eventId: job.data.eventId, result }));
paymentWebhookWorker.on('failed', (job, error) => console.error('Falha no processamento de webhook de pagamento', { event: 'payments.webhook_job_failed', jobId: job?.id, eventId: job?.data.eventId, error: error.message }));

const shutdown = async (signal: string) => {
  console.log('Encerramento do worker solicitado', { event: 'monitor.document_worker_shutdown', signal });
  stopWorkerHeartbeat();
  dailyChallengeScheduler.stop();
  clearInterval(paymentWebhookRecoveryTimer);
  await worker.close();
  await weeklySimulationWorker.close();
  await paymentWebhookWorker.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
