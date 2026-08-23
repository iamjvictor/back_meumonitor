import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const DOCUMENT_QUEUE_NAME = 'monitor-documents';

export type DocumentJob = {
  documentId: string;
};

export const documentQueueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const documentQueue = new Queue<DocumentJob>(DOCUMENT_QUEUE_NAME, {
  connection: documentQueueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 5000, age: 604800 },
  },
});

export async function closeDocumentQueue() {
  await documentQueue.close();
  await documentQueueConnection.quit();
}
