ALTER TABLE "document_chunks"
ADD COLUMN "page_start" INTEGER,
ADD COLUMN "page_end" INTEGER;

CREATE INDEX "document_chunks_document_id_page_start_page_end_idx"
ON "document_chunks"("document_id", "page_start", "page_end");
