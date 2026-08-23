import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { DOCUMENT_QUEUE_NAME, type DocumentJob } from './queues/document.queue.js';
import { markDocumentFailed } from './repositories/document-worker.repository.js';
import { DocumentWorkerService } from './worker/services/document-worker.service.js';

const redisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerService = new DocumentWorkerService();

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
  await worker.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
