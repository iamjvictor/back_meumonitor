ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT,
  ADD COLUMN IF NOT EXISTS "embedded_at" TIMESTAMPTZ;

DROP INDEX IF EXISTS "document_chunks_embedding_hnsw_idx";
DROP INDEX IF EXISTS "questions_embedding_hnsw_idx";

CREATE INDEX "document_chunks_embedding_ready_hnsw_idx"
  ON "document_chunks"
  USING hnsw (("embedding"::extensions.halfvec(2048)) extensions.halfvec_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "status" = 'READY'::"ChunkStatus";

CREATE INDEX "questions_embedding_active_hnsw_idx"
  ON "questions"
  USING hnsw (("embedding"::extensions.halfvec(2048)) extensions.halfvec_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "status" <> 'REJECTED'::"QuestionStatus";

CREATE INDEX IF NOT EXISTS "document_blocks_document_id_block_index_idx"
  ON "document_blocks"("document_id", "block_index");

CREATE INDEX IF NOT EXISTS "document_block_topics_topic_id_block_id_idx"
  ON "document_block_topics"("topic_id", "block_id");

CREATE INDEX IF NOT EXISTS "document_chunks_block_id_chunk_index_in_block_idx"
  ON "document_chunks"("block_id", "chunk_index_in_block");
