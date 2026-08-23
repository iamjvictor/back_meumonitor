DO $$
BEGIN
  CREATE TYPE "DocumentBlockType" AS ENUM (
    'TITLE', 'SECTION', 'SUBSECTION', 'THEORY', 'DEFINITION', 'FORMULA',
    'EXAMPLE', 'QUESTION', 'ANSWER_KEY', 'SOLUTION', 'TABLE', 'LIST',
    'IMAGE_REFERENCE', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "DocumentBlockDetectionMethod" AS ENUM ('REGEX', 'HEURISTIC', 'LLM', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "DocumentBlockStatus" AS ENUM ('READY', 'NEEDS_REVIEW', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "document_blocks" (
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_blocks_document_text_id_block_index_key"
ON "document_blocks"("document_text_id", "block_index");
CREATE INDEX IF NOT EXISTS "document_blocks_document_id_type_block_index_idx"
ON "document_blocks"("document_id", "type", "block_index");
CREATE INDEX IF NOT EXISTS "document_blocks_document_text_id_page_start_page_end_idx"
ON "document_blocks"("document_text_id", "page_start", "page_end");
CREATE INDEX IF NOT EXISTS "document_blocks_document_id_question_number_idx"
ON "document_blocks"("document_id", "question_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_blocks_document_id_fkey'
      AND conrelid = 'document_blocks'::regclass
  ) THEN
    ALTER TABLE "document_blocks"
      ADD CONSTRAINT "document_blocks_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_blocks_document_text_id_fkey'
      AND conrelid = 'document_blocks'::regclass
  ) THEN
    ALTER TABLE "document_blocks"
      ADD CONSTRAINT "document_blocks_document_text_id_fkey"
      FOREIGN KEY ("document_text_id") REFERENCES "document_texts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_blocks_parent_block_id_fkey'
      AND conrelid = 'document_blocks'::regclass
  ) THEN
    ALTER TABLE "document_blocks"
      ADD CONSTRAINT "document_blocks_parent_block_id_fkey"
      FOREIGN KEY ("parent_block_id") REFERENCES "document_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
