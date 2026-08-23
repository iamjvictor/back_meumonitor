ALTER TABLE "monitor_documents"
  ADD COLUMN IF NOT EXISTS "processing_version" INTEGER;

UPDATE "monitor_documents"
SET "processing_version" = 1
WHERE "processing_version" IS NULL;

ALTER TABLE "monitor_documents"
  ALTER COLUMN "processing_version" SET DEFAULT 2,
  ALTER COLUMN "processing_version" SET NOT NULL;

ALTER TABLE "monitor_documents"
  ADD CONSTRAINT "monitor_documents_processing_version_check"
  CHECK ("processing_version" IN (1, 2));

CREATE INDEX IF NOT EXISTS "monitor_documents_processing_version_status_idx"
  ON "monitor_documents"("processing_version", "status");

COMMENT ON COLUMN "monitor_documents"."processing_version" IS
  '1 = legado; 2 = pipeline structure-aware com jobs persistidos.';

-- O backend acessa estes dados com credencial privilegiada e valida ownership.
-- Sem policies publicas, anon/authenticated nao leem dados sensiveis diretamente.
ALTER TABLE "monitor_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_processing_jobs" ENABLE ROW LEVEL SECURITY;
