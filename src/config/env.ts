import dotenv from 'dotenv';
import { z } from 'zod';

// No desenvolvimento, o .env do projeto deve prevalecer sobre variáveis
// antigas que ficaram exportadas no terminal/PM2. Em produção, mantemos a
// precedência das variáveis injetadas pelo ambiente de deploy.
dotenv.config({ override: process.env.NODE_ENV !== 'production' });

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
  DOCUMENT_INGESTION_V3_ENABLED: z.preprocess((value) => value === 'true', z.boolean()).default(false),
  DOCUMENT_PARSER_BASE_URL: z.string().url().optional(),
  DOCUMENT_PARSER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DOCUMENT_PARSER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(1),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  AI_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high']).default('low'),
  OPENROUTER_EMBEDDING_MODEL: z.string().min(1),
  OPENROUTER_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(2048),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(256).default(64),
  RAG_PARENT_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(900),
  RAG_PARENT_CHUNK_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  RAG_CHILD_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(350),
  RAG_CHILD_CHUNK_MAX_TOKENS: z.coerce.number().int().positive().default(500),
  RAG_CHILD_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().positive().default(50),
  EMBEDDING_MIN_TOKENS: z.coerce.number().int().positive().default(40),
  EMBEDDING_MIN_CHARS: z.coerce.number().int().positive().default(180),
  OPENROUTER_QUESTION_MODEL: z.string().min(1),
  OPENROUTER_STRUCTURED_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CHAT_AI_MODEL: z.string().min(1).optional(),
  CHAT_AI_MAX_TOKENS: z.coerce.number().int().positive().default(600),
  CHAT_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  CHAT_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  FLASHCARD_GENERATION_MODEL: z.string().min(1).default('openai/gpt-5-mini'),
  FLASHCARD_GENERATION_FALLBACK_MODEL: z.string().min(1).nullable().optional().default('google/gemini-3.7-flash'),
  QUESTION_EXTRACTION_MODEL: z.string().min(1).optional(),
  QUESTION_EXTRACTION_MAX_TOKENS: z.coerce.number().int().positive().default(4000),
  QUESTION_EXTRACTION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  QUESTION_SOURCE_RECONSTRUCTION_MODEL: z.string().min(1).optional(),
  QUESTION_SOURCE_RECONSTRUCTION_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  QUESTION_SOURCE_RECONSTRUCTION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  QUESTION_COMPLETION_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  QUESTION_CATEGORIZE_MODEL: z.string().min(1).optional(),
  QUESTION_CATEGORIZE_MAX_TOKENS: z.coerce.number().int().positive().default(256),
  QUESTION_CATEGORIZE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  TOPIC_PROFILE_MODEL: z.string().min(1).optional(),
  TOPIC_PROFILE_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
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
  QUESTION_QUALITY_REVIEW_MODEL: z.string().min(1).optional(),
  QUESTION_QUALITY_REVIEW_MAX_TOKENS: z.coerce.number().int().positive().default(800),
  QUESTION_QUALITY_REVIEW_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MODEL: z.string().min(1).optional(),
  QUESTION_COMPLETION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  QUESTION_COMPLETION_MAX_TOKENS: z.coerce.number().int().positive().default(700),
  QUESTION_COMPLETION_FALLBACK_MODEL: z.string().optional().default('gpt-5.6-luna'),
  ENABLE_PAID_STRUCTURED_FALLBACK: z.enum(['true', 'false']).default('true'),
  BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS: z.coerce.number().int().positive().default(3000),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  BLOCK_TOPIC_CLASSIFICATION_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(20),
  QUESTION_CANDIDATE_CONCURRENCY: z.coerce.number().int().positive().max(8).default(3),
  FLASHCARD_GENERATION_CONCURRENCY: z.coerce.number().int().positive().max(8).default(3),
  CORS_ORIGINS: z.string().default(''),
  PAYMENTS_SIMULATION_ENABLED: z.preprocess((value) => value === 'true', z.boolean()).default(false),
  PAYMENTS_TEST_PRICE_CENTS: z.coerce.number().int().positive().default(1990),
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
