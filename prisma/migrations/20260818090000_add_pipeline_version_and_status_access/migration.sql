ALTER TABLE "monitor_documents" ADD COLUMN "processing_version" INTEGER;
UPDATE "monitor_documents" SET "processing_version" = 1 WHERE "processing_version" IS NULL;
ALTER TABLE "monitor_documents" ALTER COLUMN "processing_version" SET DEFAULT 2;
ALTER TABLE "monitor_documents" ALTER COLUMN "processing_version" SET NOT NULL;
ALTER TABLE "monitor_documents" ADD CONSTRAINT "monitor_documents_processing_version_check" CHECK ("processing_version" IN (1, 2));
CREATE INDEX "monitor_documents_processing_version_status_idx" ON "monitor_documents"("processing_version", "status");
