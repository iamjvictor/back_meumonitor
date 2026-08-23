CREATE TYPE "DocumentTextQuality" AS ENUM (
  'GOOD',
  'PARTIAL',
  'NEEDS_OCR',
  'FAILED'
);

CREATE TYPE "DocumentStatus_new" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
  'NEEDS_OCR'
);

ALTER TABLE "monitor_documents"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DocumentStatus_new"
    USING "status"::text::"DocumentStatus_new";

DROP TYPE "DocumentStatus";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
ALTER TABLE "monitor_documents"
  ALTER COLUMN "status" SET DEFAULT 'QUEUED'::"DocumentStatus";

CREATE TABLE "document_texts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "extraction_version" TEXT NOT NULL,
  "raw_content" TEXT NOT NULL,
  "normalized_content" TEXT,
  "page_count" INTEGER,
  "quality" "DocumentTextQuality" NOT NULL DEFAULT 'GOOD',
  "quality_details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "document_texts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_texts_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE
);

CREATE TABLE "document_pages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_text_id" UUID NOT NULL,
  "page_number" INTEGER NOT NULL,
  "raw_content" TEXT NOT NULL,
  "normalized_content" TEXT,
  "has_images" BOOLEAN,
  "char_start" INTEGER,
  "char_end" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_pages_document_text_id_fkey"
    FOREIGN KEY ("document_text_id") REFERENCES "document_texts"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "document_texts_document_id_extraction_version_key"
  ON "document_texts"("document_id", "extraction_version");
CREATE INDEX "document_texts_document_id_created_at_idx"
  ON "document_texts"("document_id", "created_at");
CREATE UNIQUE INDEX "document_pages_document_text_id_page_number_key"
  ON "document_pages"("document_text_id", "page_number");
CREATE INDEX "document_pages_document_text_id_page_number_idx"
  ON "document_pages"("document_text_id", "page_number");

ALTER TABLE "document_texts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_pages" ENABLE ROW LEVEL SECURITY;
