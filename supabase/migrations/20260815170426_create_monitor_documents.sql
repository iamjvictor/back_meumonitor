CREATE TYPE "DocumentTag" AS ENUM ('KNOWLEDGE_BASE', 'QUESTIONS', 'FLASHCARDS');
CREATE TYPE "DocumentStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "monitor_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "monitor_id" UUID NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
  "subject_id" UUID NOT NULL REFERENCES "monitor_subjects"("id") ON DELETE CASCADE,
  "topic_id" UUID REFERENCES "monitor_topics"("id") ON DELETE SET NULL,
  "tag" "DocumentTag" NOT NULL,
  "original_name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'QUEUED',
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "monitor_documents_monitor_id_tag_status_idx" ON "monitor_documents"("monitor_id", "tag", "status");
CREATE INDEX "monitor_documents_subject_id_tag_idx" ON "monitor_documents"("subject_id", "tag");
CREATE INDEX "monitor_documents_topic_id_tag_idx" ON "monitor_documents"("topic_id", "tag");

ALTER TABLE "monitor_documents" ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'monitor-documents',
  'monitor-documents',
  false,
  5242880,
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
