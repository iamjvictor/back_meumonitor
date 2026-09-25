export const WORKER_HEARTBEAT_KEY = 'monitor:worker:heartbeat:v1';
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;

export type WorkerHealthClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
};

export async function getWorkerHealth(redis: Pick<WorkerHealthClient, 'get'>) {
  const heartbeat = await redis.get(WORKER_HEARTBEAT_KEY);
  return { ready: Boolean(heartbeat) };
}

export function startWorkerHeartbeat(
  redis: WorkerHealthClient,
  intervalMs = WORKER_HEARTBEAT_INTERVAL_MS,
) {
  const publish = () => {
    void redis.set(
      WORKER_HEARTBEAT_KEY,
      new Date().toISOString(),
      'EX',
      WORKER_HEARTBEAT_TTL_SECONDS,
    ).catch((error: unknown) => {
      console.warn('Falha ao publicar heartbeat do worker', {
        event: 'monitor.worker_heartbeat_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  publish();
  const timer = setInterval(publish, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
