CREATE TYPE "DocumentProcessingOperation" AS ENUM (
  'EXTRACT_TEXT', 'NORMALIZE_TEXT', 'DETECT_BLOCKS', 'CLASSIFY_BLOCKS',
  'CREATE_RETRIEVAL_CHUNKS', 'GENERATE_CHUNK_EMBEDDINGS',
  'EXTRACT_QUESTIONS_TO_PENDING_REVIEW', 'MATCH_ANSWER_KEYS',
  'GENERATE_FLASHCARD_CANDIDATES', 'READY_FOR_REVIEW'
);

CREATE TYPE "DocumentProcessingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PARTIAL_SUCCESS', 'READY', 'FAILED', 'SKIPPED');

CREATE TABLE "document_processing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "operation" "DocumentProcessingOperation" NOT NULL,
  "processing_version" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "DocumentProcessingJobStatus" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "input_snapshot" JSONB,
  "output_summary" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_processing_jobs_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "document_processing_jobs_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "document_processing_jobs_document_id_operation_processing_version_key"
  ON "document_processing_jobs"("document_id", "operation", "processing_version");
CREATE INDEX "document_processing_jobs_document_id_status_idx"
  ON "document_processing_jobs"("document_id", "status");
CREATE INDEX "document_processing_jobs_operation_status_idx"
  ON "document_processing_jobs"("operation", "status");
ALTER TABLE "document_processing_jobs" ENABLE ROW LEVEL SECURITY;
