ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "block_id" UUID,
  ADD COLUMN IF NOT EXISTS "chunk_index_in_block" INTEGER,
  ADD COLUMN IF NOT EXISTS "embedding_content" TEXT,
  ADD COLUMN IF NOT EXISTS "token_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "char_start" INTEGER,
  ADD COLUMN IF NOT EXISTS "char_end" INTEGER,
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT,
  ADD COLUMN IF NOT EXISTS "embedded_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_block_id_chunk_index_in_block_key"
ON "document_chunks"("block_id", "chunk_index_in_block");

CREATE INDEX IF NOT EXISTS "document_chunks_block_id_chunk_index_in_block_idx"
ON "document_chunks"("block_id", "chunk_index_in_block");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_chunks_block_id_fkey'
      AND conrelid = 'document_chunks'::regclass
  ) THEN
    ALTER TABLE "document_chunks"
      ADD CONSTRAINT "document_chunks_block_id_fkey"
      FOREIGN KEY ("block_id") REFERENCES "document_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
