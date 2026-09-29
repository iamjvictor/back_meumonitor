export const WORKER_DRAIN_DELAY_SECONDS = 60;
export const WORKER_STALLED_INTERVAL_MS = 5 * 60_000;

export function createQueueWorkerOptions<T>(connection: T, concurrency: number) {
  return {
    connection,
    concurrency,
    drainDelay: WORKER_DRAIN_DELAY_SECONDS,
    stalledInterval: WORKER_STALLED_INTERVAL_MS,
  };
}
