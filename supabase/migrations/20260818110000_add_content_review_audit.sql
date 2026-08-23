ALTER TABLE "flashcards"
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "reviewed_by" UUID REFERENCES "teachers"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "flashcards_review_status_idx"
  ON "flashcards"("monitor_id", "status", "reviewed_at");
