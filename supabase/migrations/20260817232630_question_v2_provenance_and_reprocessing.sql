CREATE TYPE "QuestionContentOrigin" AS ENUM (
  'SOURCE_DOCUMENT',
  'RECONSTRUCTED_FROM_DOCUMENT',
  'INHERITED_STRUCTURE',
  'RULE_BASED',
  'VECTOR_CLASSIFIED',
  'EXTERNAL_SOURCE',
  'AI_GENERATED',
  'TEACHER_EDITED',
  'TEACHER_CREATED'
);

CREATE TYPE "QuestionCompletenessStatus" AS ENUM (
  'COMPLETE_FROM_SOURCE',
  'COMPLETE_WITH_EXTERNAL_ANSWER',
  'COMPLETE_WITH_AI',
  'MISSING_ALTERNATIVES',
  'MISSING_ANSWER',
  'MISSING_EXPLANATION',
  'INVALID_FRAGMENT'
);

CREATE TYPE "QuestionSourceRole" AS ENUM (
  'STATEMENT',
  'ALTERNATIVE',
  'ANSWER_KEY',
  'EXPLANATION',
  'CATEGORY_CONTEXT',
  'CONTEXT'
);

CREATE TYPE "QuestionAiGenerationType" AS ENUM (
  'ALTERNATIVES',
  'CORRECT_ANSWER',
  'EXPLANATION',
  'CATEGORY',
  'DIFFICULTY',
  'FULL_ENRICHMENT'
);

ALTER TYPE "QuestionAnswerOrigin" ADD VALUE IF NOT EXISTS 'EXTERNAL_SOURCE';
ALTER TYPE "QuestionExplanationOrigin" ADD VALUE IF NOT EXISTS 'EXTERNAL_SOURCE';

ALTER TABLE "questions"
  ADD COLUMN "statement_origin" "QuestionContentOrigin" NOT NULL DEFAULT 'SOURCE_DOCUMENT',
  ADD COLUMN "alternatives_origin" "QuestionContentOrigin",
  ADD COLUMN "category_origin" "QuestionContentOrigin",
  ADD COLUMN "difficulty" TEXT,
  ADD COLUMN "difficulty_origin" "QuestionContentOrigin",
  ADD COLUMN "statement_confidence" DOUBLE PRECISION,
  ADD COLUMN "alternatives_confidence" DOUBLE PRECISION,
  ADD COLUMN "correct_answer_confidence" DOUBLE PRECISION,
  ADD COLUMN "explanation_confidence" DOUBLE PRECISION,
  ADD COLUMN "category_confidence" DOUBLE PRECISION,
  ADD COLUMN "difficulty_confidence" DOUBLE PRECISION,
  ADD COLUMN "completeness_status" "QuestionCompletenessStatus" NOT NULL DEFAULT 'MISSING_ANSWER',
  ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "quality_score" DOUBLE PRECISION;

ALTER TABLE "question_sources"
  ADD COLUMN "id" UUID DEFAULT gen_random_uuid(),
  ADD COLUMN "document_id" UUID REFERENCES "monitor_documents"("id") ON DELETE CASCADE,
  ADD COLUMN "document_block_id" UUID REFERENCES "document_blocks"("id") ON DELETE CASCADE,
  ADD COLUMN "role" "QuestionSourceRole" NOT NULL DEFAULT 'CONTEXT',
  ADD COLUMN "page_start" INTEGER,
  ADD COLUMN "page_end" INTEGER,
  ADD COLUMN "char_start_in_chunk" INTEGER,
  ADD COLUMN "char_end_in_chunk" INTEGER,
  ADD COLUMN "excerpt" TEXT,
  ADD COLUMN "confidence" DOUBLE PRECISION;

ALTER TABLE "question_sources"
  ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "question_sources"
  DROP CONSTRAINT "question_sources_pkey";
ALTER TABLE "question_sources"
  ADD CONSTRAINT "question_sources_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "question_sources_question_chunk_role_key"
  ON "question_sources"("question_id", "chunk_id", "role");

UPDATE "question_sources" qs
SET "document_id" = dc."document_id",
    "document_block_id" = dc."block_id",
    "excerpt" = dc."content"
FROM "document_chunks" dc
WHERE dc."id" = qs."chunk_id";

CREATE INDEX "question_sources_question_id_role_idx"
  ON "question_sources"("question_id", "role");
CREATE INDEX "question_sources_document_id_idx"
  ON "question_sources"("document_id");

CREATE TABLE "question_ai_generations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "question_id" UUID NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "generation_type" "QuestionAiGenerationType" NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT,
  "input_snapshot" JSONB NOT NULL,
  "output_snapshot" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "accepted_at" TIMESTAMPTZ,
  "accepted_by" UUID REFERENCES "teachers"("id") ON DELETE SET NULL,
  "rejected_at" TIMESTAMPTZ,
  "rejection_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "question_ai_generations_question_type_idx"
  ON "question_ai_generations"("question_id", "generation_type");
ALTER TABLE "question_ai_generations" ENABLE ROW LEVEL SECURITY;
