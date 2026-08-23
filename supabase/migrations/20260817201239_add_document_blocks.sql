CREATE TYPE "DocumentBlockType" AS ENUM (
  'TITLE',
  'SECTION',
  'SUBSECTION',
  'THEORY',
  'DEFINITION',
  'FORMULA',
  'EXAMPLE',
  'QUESTION',
  'ANSWER_KEY',
  'SOLUTION',
  'TABLE',
  'LIST',
  'IMAGE_REFERENCE',
  'UNKNOWN'
);

CREATE TYPE "DocumentBlockDetectionMethod" AS ENUM (
  'REGEX',
  'HEURISTIC',
  'LLM',
  'MANUAL'
);

CREATE TYPE "DocumentBlockStatus" AS ENUM (
  'READY',
  'NEEDS_REVIEW',
  'FAILED'
);

CREATE TABLE "document_blocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "document_text_id" UUID NOT NULL,
  "parent_block_id" UUID,
  "block_index" INTEGER NOT NULL,
  "type" "DocumentBlockType" NOT NULL,
  "title" TEXT,
  "raw_content" TEXT NOT NULL,
  "normalized_content" TEXT NOT NULL,
  "section_path" JSONB,
  "question_number" TEXT,
  "institution" TEXT,
  "exam_year" INTEGER,
  "page_start" INTEGER,
  "page_end" INTEGER,
  "char_start" INTEGER NOT NULL,
  "char_end" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "detection_method" "DocumentBlockDetectionMethod" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" "DocumentBlockStatus" NOT NULL DEFAULT 'READY',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "document_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_blocks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE,
  CONSTRAINT "document_blocks_document_text_id_fkey"
    FOREIGN KEY ("document_text_id") REFERENCES "document_texts"("id") ON DELETE CASCADE,
  CONSTRAINT "document_blocks_parent_block_id_fkey"
    FOREIGN KEY ("parent_block_id") REFERENCES "document_blocks"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "document_blocks_document_text_id_block_index_key"
  ON "document_blocks"("document_text_id", "block_index");
CREATE INDEX "document_blocks_document_id_type_block_index_idx"
  ON "document_blocks"("document_id", "type", "block_index");
CREATE INDEX "document_blocks_document_text_id_page_start_page_end_idx"
  ON "document_blocks"("document_text_id", "page_start", "page_end");
CREATE INDEX "document_blocks_document_id_question_number_idx"
  ON "document_blocks"("document_id", "question_number");

ALTER TABLE "document_blocks" ENABLE ROW LEVEL SECURITY;
