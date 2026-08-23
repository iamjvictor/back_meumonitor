CREATE TYPE "DocumentBlockTopicMethod" AS ENUM (
  'INHERITED', 'RULE', 'LLM', 'TEACHER'
);

CREATE TYPE "DocumentBlockTopicStatus" AS ENUM (
  'PENDING', 'CLASSIFIED', 'OUT_OF_SCOPE', 'REJECTED'
);

CREATE TABLE "document_block_topics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "block_id" UUID NOT NULL,
  "topic_id" UUID,
  "classification_method" "DocumentBlockTopicMethod" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" "DocumentBlockTopicStatus" NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "document_block_topics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_block_topics_block_id_fkey"
    FOREIGN KEY ("block_id") REFERENCES "document_blocks"("id") ON DELETE CASCADE,
  CONSTRAINT "document_block_topics_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE
);

CREATE INDEX "document_block_topics_topic_id_status_block_id_idx"
  ON "document_block_topics"("topic_id", "status", "block_id");
CREATE INDEX "document_block_topics_block_id_status_is_primary_idx"
  ON "document_block_topics"("block_id", "status", "is_primary");
CREATE UNIQUE INDEX "document_block_topics_block_id_topic_id_key"
  ON "document_block_topics"("block_id", "topic_id");

ALTER TABLE "document_block_topics" ENABLE ROW LEVEL SECURITY;
