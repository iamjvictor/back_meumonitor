CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TYPE "ChunkStatus" AS ENUM ('EMBEDDING_PENDING', 'EMBEDDING_PROCESSING', 'READY', 'FAILED');

CREATE TABLE "monitor_document_topics" (
  "document_id" UUID NOT NULL,
  "topic_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monitor_document_topics_pkey" PRIMARY KEY ("document_id", "topic_id"),
  CONSTRAINT "monitor_document_topics_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "monitor_document_topics_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "monitor_document_topics_topic_id_document_id_idx"
  ON "monitor_document_topics"("topic_id", "document_id");

INSERT INTO "monitor_document_topics" ("document_id", "topic_id")
SELECT document."id", topic."id"
FROM "monitor_documents" AS document
JOIN "monitor_topics" AS topic ON topic."subject_id" = document."subject_id"
WHERE document."topic_id" IS NULL OR document."topic_id" = topic."id"
ON CONFLICT ("document_id", "topic_id") DO NOTHING;

CREATE TABLE "document_chunks" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "char_count" INTEGER NOT NULL,
  "status" "ChunkStatus" NOT NULL DEFAULT 'EMBEDDING_PENDING',
  "embedding" extensions.vector(1536),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_chunks_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_chunks_monitor_id_fkey"
    FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_chunks_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "monitor_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key"
  ON "document_chunks"("document_id", "chunk_index");
CREATE INDEX "document_chunks_monitor_id_subject_id_idx"
  ON "document_chunks"("monitor_id", "subject_id");
CREATE INDEX "document_chunks_teacher_id_monitor_id_idx"
  ON "document_chunks"("teacher_id", "monitor_id");
CREATE INDEX "document_chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" extensions.vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

CREATE TABLE "document_chunk_topics" (
  "chunk_id" UUID NOT NULL,
  "topic_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_chunk_topics_pkey" PRIMARY KEY ("chunk_id", "topic_id"),
  CONSTRAINT "document_chunk_topics_chunk_id_fkey"
    FOREIGN KEY ("chunk_id") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_chunk_topics_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "document_chunk_topics_topic_id_chunk_id_idx"
  ON "document_chunk_topics"("topic_id", "chunk_id");

ALTER TABLE "monitor_document_topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunk_topics" ENABLE ROW LEVEL SECURITY;
