ALTER TABLE "document_chunks"
  ADD COLUMN "block_id" UUID,
  ADD COLUMN "chunk_index_in_block" INTEGER,
  ADD COLUMN "embedding_content" TEXT,
  ADD COLUMN "token_count" INTEGER,
  ADD COLUMN "char_start" INTEGER,
  ADD COLUMN "char_end" INTEGER,
  ADD COLUMN "embedding_model" TEXT,
  ADD COLUMN "embedding_version" TEXT,
  ADD COLUMN "embedded_at" TIMESTAMPTZ;

ALTER TABLE "document_chunks"
  ADD CONSTRAINT "document_chunks_block_id_fkey"
  FOREIGN KEY ("block_id") REFERENCES "document_blocks"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "document_chunks_block_id_chunk_index_in_block_key"
  ON "document_chunks"("block_id", "chunk_index_in_block");
CREATE INDEX "document_chunks_block_id_chunk_index_in_block_idx"
  ON "document_chunks"("block_id", "chunk_index_in_block");
