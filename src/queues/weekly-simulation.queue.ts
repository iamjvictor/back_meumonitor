import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const WEEKLY_SIMULATION_QUEUE_NAME = 'monitor-weekly-simulations';
export type WeeklySimulationJob = { simulationId: string };

export const weeklySimulationQueueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const weeklySimulationQueue = new Queue<WeeklySimulationJob>(WEEKLY_SIMULATION_QUEUE_NAME, {
  connection: weeklySimulationQueueConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 1000, age: 3600 }, removeOnFail: { count: 5000, age: 604800 } },
});

export async function closeWeeklySimulationQueue() {
  await weeklySimulationQueue.close();
  await weeklySimulationQueueConnection.quit();
}
