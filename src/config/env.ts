import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  SUPABASE_URL: z.string().url().refine((value) => !value.includes('/rest/v1'), {
    message: 'SUPABASE_URL deve ser a URL raiz do projeto, sem /rest/v1',
  }),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_EMBEDDING_MODEL: z.string().min(1),
  OPENROUTER_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(2048),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(256).default(64),
  OPENROUTER_QUESTION_MODEL: z.string().min(1),
  QUESTION_EXTRACTION_MODEL: z.string().min(1).optional(),
  QUESTION_EXTRACTION_MAX_TOKENS: z.coerce.number().int().positive().default(4000),
  QUESTION_EXTRACTION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  QUESTION_COMPLETION_MODEL: z.string().min(1).default('z-ai/glm-5.2:free'),
  QUESTION_CATEGORIZE_MODEL: z.string().min(1).optional(),
  QUESTION_CATEGORIZE_MAX_TOKENS: z.coerce.number().int().positive().default(256),
  QUESTION_CATEGORIZE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  TOPIC_PROFILE_MODEL: z.string().min(1).optional(),
  TOPIC_PROFILE_MAX_TOKENS: z.coerce.number().int().positive().default(700),
  TOPIC_PROFILE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  QUESTION_ALTERNATIVES_MODEL: z.string().min(1).optional(),
  QUESTION_ALTERNATIVES_MAX_TOKENS: z.coerce.number().int().positive().default(300),
  QUESTION_ALTERNATIVES_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
  QUESTION_ANSWER_MODEL: z.string().min(1).optional(),
  QUESTION_ANSWER_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  QUESTION_ANSWER_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  QUESTION_EXPLANATION_MODEL: z.string().min(1).optional(),
  QUESTION_EXPLANATION_MAX_TOKENS: z.coerce.number().int().positive().default(350),
  QUESTION_EXPLANATION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.4),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MODEL: z.string().min(1).optional(),
  QUESTION_COMPLETION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  QUESTION_COMPLETION_MAX_TOKENS: z.coerce.number().int().positive().default(700),
  QUESTION_COMPLETION_FALLBACK_MODEL: z.string().optional().default(''),
  ENABLE_PAID_STRUCTURED_FALLBACK: z.enum(['true', 'false']).default('false'),
  BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS: z.coerce.number().int().positive().default(3000),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  BLOCK_TOPIC_CLASSIFICATION_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(8),
  QUESTION_CANDIDATE_CONCURRENCY: z.coerce.number().int().positive().max(8).default(3),
  CORS_ORIGINS: z.string().default(''),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const missingVariables = parsedEnv.error.issues
    .filter((issue) => issue.code === 'invalid_type')
    .map((issue) => issue.path.join('.'));

  throw new Error(
    missingVariables.length > 0
      ? `Configuracao incompleta. Crie backend/.env a partir de .env.example e preencha: ${missingVariables.join(', ')}`
      : `Configuracao invalida: ${parsedEnv.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
  );
}

export const env = parsedEnv.data;

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
