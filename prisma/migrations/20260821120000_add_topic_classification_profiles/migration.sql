ALTER TABLE "monitor_topics"
  ADD COLUMN IF NOT EXISTS "definition" TEXT,
  ADD COLUMN IF NOT EXISTS "classification_guidance" TEXT,
  ADD COLUMN IF NOT EXISTS "definition_origin" TEXT,
  ADD COLUMN IF NOT EXISTS "definition_model" TEXT,
  ADD COLUMN IF NOT EXISTS "definition_sources" JSONB,
  ADD COLUMN IF NOT EXISTS "definition_updated_at" TIMESTAMP(3);
