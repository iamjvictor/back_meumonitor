ALTER TABLE "flashcards" ADD COLUMN "reviewed_at" TIMESTAMPTZ;
ALTER TABLE "flashcards" ADD COLUMN "reviewed_by" UUID;
CREATE INDEX "flashcards_review_status_idx" ON "flashcards"("monitor_id", "status", "reviewed_at");
