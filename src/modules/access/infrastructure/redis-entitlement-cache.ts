export type EntitlementCacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
};

export const ENTITLEMENT_TTL_SECONDS = 60;

export class RedisEntitlementCache {
  constructor(private readonly redis: EntitlementCacheClient, private readonly environment: string) {}

  key(studentId: string) {
    return `entitlement:v1:${this.environment.toLowerCase()}:${studentId}`;
  }

  async get<T>(studentId: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.key(studentId));
      return value ? JSON.parse(value) as T : null;
    } catch (error) {
      console.warn('Falha ao ler snapshot de acesso no Redis', { event: 'access.redis_fallback', studentId, error: error instanceof Error ? error.message : 'unknown' });
      return null;
    }
  }

  async set(studentId: string, value: unknown) {
    try {
      await this.redis.set(this.key(studentId), JSON.stringify(value), 'EX', ENTITLEMENT_TTL_SECONDS);
    } catch (error) {
      console.warn('Falha ao salvar snapshot de acesso no Redis', { event: 'access.redis_fallback', studentId, error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  async invalidate(studentId: string) {
    try {
      await this.redis.del(this.key(studentId));
    } catch (error) {
      console.warn('Falha ao invalidar snapshot de acesso no Redis', { event: 'access.redis_fallback', studentId, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
}
