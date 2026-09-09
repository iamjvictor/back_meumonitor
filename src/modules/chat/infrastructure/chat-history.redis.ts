import { Redis } from 'ioredis';
import { env } from '../../../config/env.js';

/** Conexão exclusiva do histórico temporário do chat. Não é a conexão da BullMQ. */
export const chatHistoryRedis = new Redis(env.REDIS_URL);
