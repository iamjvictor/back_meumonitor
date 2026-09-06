CREATE TYPE "QuestionSpanStatus" AS ENUM (
  'DETECTED', 'ASSEMBLED', 'VISUAL_PENDING', 'READY_FOR_COMPLETION', 'BLOCKED', 'REVIEW_REQUIRED'
);

CREATE TYPE "QuestionVisualStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_EXTRACTION', 'AVAILABLE', 'MISSING');
CREATE TYPE "QuestionSpanChunkRole" AS ENUM ('PREVIOUS', 'PRIMARY', 'NEXT', 'ANSWER_KEY', 'EXPLANATION');
CREATE TYPE "QuestionCandidateOrigin" AS ENUM ('DETERMINISTIC', 'LAYOUT', 'OCR', 'AI_RECONSTRUCTED');
CREATE TYPE "QuestionCandidateStatus" AS ENUM (
  'DETECTED', 'ASSEMBLED', 'VALIDATED', 'VISUAL_PENDING', 'READY_FOR_COMPLETION', 'BLOCKED', 'REVIEW_REQUIRED', 'PROMOTED'
);

CREATE TABLE "question_spans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "document_block_id" UUID,
  "source_key" TEXT NOT NULL,
  "question_number" TEXT,
  "page_start" INTEGER,
  "page_end" INTEGER,
  "char_start" INTEGER,
  "char_end" INTEGER,
  "status" "QuestionSpanStatus" NOT NULL DEFAULT 'DETECTED',
  "visual_status" "QuestionVisualStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_spans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "question_spans_source_key_key" ON "question_spans"("source_key");
CREATE INDEX "question_spans_document_id_status_idx" ON "question_spans"("document_id", "status");
CREATE INDEX "question_spans_document_block_id_idx" ON "question_spans"("document_block_id");

ALTER TABLE "question_spans" ADD CONSTRAINT "question_spans_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_spans" ADD CONSTRAINT "question_spans_document_block_id_fkey"
  FOREIGN KEY ("document_block_id") REFERENCES "document_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "question_span_chunks" (
  "question_span_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "role" "QuestionSpanChunkRole" NOT NULL DEFAULT 'PRIMARY',
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_span_chunks_pkey" PRIMARY KEY ("question_span_id", "chunk_id")
);
CREATE INDEX "question_span_chunks_chunk_id_question_span_id_idx" ON "question_span_chunks"("chunk_id", "question_span_id");
ALTER TABLE "question_span_chunks" ADD CONSTRAINT "question_span_chunks_question_span_id_fkey"
  FOREIGN KEY ("question_span_id") REFERENCES "question_spans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_span_chunks" ADD CONSTRAINT "question_span_chunks_chunk_id_fkey"
  FOREIGN KEY ("chunk_id") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "question_candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "question_span_id" UUID NOT NULL,
  "statement" TEXT NOT NULL,
  "alternatives" JSONB NOT NULL,
  "correct_answer" TEXT,
  "explanation" TEXT,
  "origin_type" "QuestionCandidateOrigin" NOT NULL,
  "status" "QuestionCandidateStatus" NOT NULL DEFAULT 'DETECTED',
  "promotion_reasons" JSONB NOT NULL,
  "structural_state" TEXT,
  "confidence" DOUBLE PRECISION,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_candidates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "question_candidates_question_span_id_key" ON "question_candidates"("question_span_id");
CREATE INDEX "question_candidates_status_origin_type_idx" ON "question_candidates"("status", "origin_type");
ALTER TABLE "question_candidates" ADD CONSTRAINT "question_candidates_question_span_id_fkey"
  FOREIGN KEY ("question_span_id") REFERENCES "question_spans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
