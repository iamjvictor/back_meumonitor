ALTER TABLE "document_blocks"
  ADD COLUMN "is_complete" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "incomplete_reason" TEXT;

CREATE INDEX "document_blocks_complete_chunking_idx"
  ON "document_blocks"("document_id", "document_text_id", "is_complete", "block_index");

ALTER TABLE "monitor_documents"
  DROP CONSTRAINT IF EXISTS "monitor_documents_processing_version_check";

ALTER TABLE "monitor_documents"
  ALTER COLUMN "processing_version" SET DEFAULT 4;

ALTER TABLE "monitor_documents"
  ADD CONSTRAINT "monitor_documents_processing_version_check"
  CHECK ("processing_version" IN (1, 2, 3, 4));
