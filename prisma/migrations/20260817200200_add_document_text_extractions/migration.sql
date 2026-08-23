DO $$
BEGIN
  CREATE TYPE "DocumentTextQuality" AS ENUM ('GOOD', 'PARTIAL', 'NEEDS_OCR', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus_new') THEN
    CREATE TYPE "DocumentStatus_new" AS ENUM ('QUEUED', 'PROCESSING', 'PARTIAL_SUCCESS', 'READY', 'FAILED', 'NEEDS_OCR');

    ALTER TABLE "monitor_documents"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "DocumentStatus_new"
        USING "status"::text::"DocumentStatus_new";

    DROP TYPE IF EXISTS "DocumentStatus";
    ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";

    ALTER TABLE "monitor_documents"
      ALTER COLUMN "status" SET DEFAULT 'QUEUED'::"DocumentStatus";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "document_texts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "extraction_version" TEXT NOT NULL,
    "raw_content" TEXT NOT NULL,
    "normalized_content" TEXT,
    "page_count" INTEGER,
    "quality" "DocumentTextQuality" NOT NULL DEFAULT 'GOOD',
    "quality_details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_texts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_text_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "raw_content" TEXT NOT NULL,
    "normalized_content" TEXT,
    "has_images" BOOLEAN,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_texts_document_id_extraction_version_key"
ON "document_texts"("document_id", "extraction_version");
CREATE INDEX IF NOT EXISTS "document_texts_document_id_created_at_idx"
ON "document_texts"("document_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "document_pages_document_text_id_page_number_key"
ON "document_pages"("document_text_id", "page_number");
CREATE INDEX IF NOT EXISTS "document_pages_document_text_id_page_number_idx"
ON "document_pages"("document_text_id", "page_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_texts_document_id_fkey'
      AND conrelid = 'document_texts'::regclass
  ) THEN
    ALTER TABLE "document_texts"
      ADD CONSTRAINT "document_texts_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_pages_document_text_id_fkey'
      AND conrelid = 'document_pages'::regclass
  ) THEN
    ALTER TABLE "document_pages"
      ADD CONSTRAINT "document_pages_document_text_id_fkey"
      FOREIGN KEY ("document_text_id") REFERENCES "document_texts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
