import type { ChatHistoryMessage, ChatHistoryScope } from '../models/chat-history.model.js';
import type { ChatHistoryPort } from '../ports/chat-history.port.js';

export const CHAT_HISTORY_TTL_SECONDS = 5 * 60 * 60;
export const CHAT_HISTORY_MAX_MESSAGES = 40;

export type RedisHistoryClient = {
  rpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string): Promise<unknown>;
};

export class RedisChatHistoryRepository implements ChatHistoryPort {
  constructor(private readonly redis: RedisHistoryClient) {}

  async append(scope: ChatHistoryScope, message: ChatHistoryMessage): Promise<void> {
    const key = buildChatHistoryKey(scope);
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.ltrim(key, -CHAT_HISTORY_MAX_MESSAGES, -1);
    await this.redis.expire(key, CHAT_HISTORY_TTL_SECONDS);
  }

  async list(scope: ChatHistoryScope): Promise<ChatHistoryMessage[]> {
    const values = await this.redis.lrange(buildChatHistoryKey(scope), 0, -1);
    return values.map((value) => JSON.parse(value) as ChatHistoryMessage);
  }

  async clear(scope: ChatHistoryScope): Promise<void> {
    await this.redis.del(buildChatHistoryKey(scope));
  }
}

export function buildChatHistoryKey(scope: ChatHistoryScope) {
  return `chat:history:v1:${scope.studentId}:${scope.monitorId}:${scope.subjectId}`;
}
