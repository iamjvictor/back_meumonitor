import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { DOCUMENT_QUEUE_NAME, type DocumentJob } from './queues/document.queue.js';
import { markDocumentFailed } from './repositories/document-worker.repository.js';
import { DocumentWorkerService } from './worker/services/document-worker.service.js';
import { startDailyChallengeScheduler } from './modules/daily_challgens/services/daily-challenge-scheduler.service.js';

const [questionGenerationEnumState] = await prisma.$queryRaw<Array<{ hasCorrection: boolean; hasNormalization: boolean }>>`
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
`;

if (!questionGenerationEnumState?.hasCorrection || !questionGenerationEnumState.hasNormalization) {
  throw new Error('Migration obrigatoria ausente: QuestionAiGenerationType.CORRECTION/NORMALIZATION. Execute npx prisma migrate deploy antes de iniciar o worker.');
}

const redisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerService = new DocumentWorkerService();
const dailyChallengeScheduler = startDailyChallengeScheduler();

const worker = new Worker<DocumentJob>(
  DOCUMENT_QUEUE_NAME,
  async (job) => workerService.process(job.data.documentId, {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  }),
  { connection: redisConnection, concurrency: 2 },
);

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

const shutdown = async (signal: string) => {
  console.log('Encerramento do worker solicitado', { event: 'monitor.document_worker_shutdown', signal });
  dailyChallengeScheduler.stop();
  await worker.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
