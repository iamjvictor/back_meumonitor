CREATE TYPE "DocumentTag" AS ENUM ('KNOWLEDGE_BASE', 'QUESTIONS', 'FLASHCARDS');
CREATE TYPE "DocumentStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "monitor_documents" (
  "id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "topic_id" UUID,
  "tag" "DocumentTag" NOT NULL,
  "original_name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'QUEUED',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monitor_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitor_documents_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "monitor_documents_monitor_id_fkey"
    FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "monitor_documents_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "monitor_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "monitor_documents_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "monitor_documents_teacher_id_idx" ON "monitor_documents"("teacher_id");
CREATE INDEX "monitor_documents_monitor_id_tag_status_idx" ON "monitor_documents"("monitor_id", "tag", "status");
CREATE INDEX "monitor_documents_subject_id_tag_idx" ON "monitor_documents"("subject_id", "tag");
CREATE INDEX "monitor_documents_topic_id_tag_idx" ON "monitor_documents"("topic_id", "tag");

ALTER TABLE "monitor_documents" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
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
  END IF;
END $$;
