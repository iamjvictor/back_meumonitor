ALTER TABLE "monitor_documents"
  DROP CONSTRAINT IF EXISTS "monitor_documents_processing_version_check";

ALTER TABLE "monitor_documents"
  ADD CONSTRAINT "monitor_documents_processing_version_check"
  CHECK ("processing_version" IN (1, 2, 3));

ALTER TABLE "monitor_documents"
  ALTER COLUMN "processing_version" SET DEFAULT 3;

COMMENT ON COLUMN "monitor_documents"."processing_version" IS
  '1 = legado; 2 = pipeline structure-aware; 3 = pipeline V2 de extração e proveniência de questões.';
