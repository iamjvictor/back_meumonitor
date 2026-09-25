import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const PUBLIC_TEACHER_PROFILE_CACHE_TTL_SECONDS = 5 * 60;

export type PublicTeacherProfileCacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export class PublicTeacherProfileCache {
  constructor(private readonly redis: PublicTeacherProfileCacheClient) {}

  async get<T>(pageSlug: string): Promise<T | null> {
    const value = await this.redis.get(buildPublicTeacherProfileCacheKey(pageSlug));
    return value ? JSON.parse(value) as T : null;
  }

  async set(pageSlug: string, profile: unknown): Promise<void> {
    await this.redis.set(
      buildPublicTeacherProfileCacheKey(pageSlug),
      JSON.stringify(profile),
      'EX',
      PUBLIC_TEACHER_PROFILE_CACHE_TTL_SECONDS,
    );
  }

  async invalidate(pageSlug: string): Promise<void> {
    await this.redis.del(buildPublicTeacherProfileCacheKey(pageSlug));
  }
}

export function buildPublicTeacherProfileCacheKey(pageSlug: string) {
  return `teacher:public-profile:v1:${pageSlug}`;
}

export function createPublicTeacherProfileCache() {
  return new PublicTeacherProfileCache(new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  }));
}
