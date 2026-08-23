ALTER TABLE "monitor_topics"
  ADD COLUMN IF NOT EXISTS "ai_definition" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_classification_guidance" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_definition_model" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_definition_sources" JSONB,
  ADD COLUMN IF NOT EXISTS "ai_definition_updated_at" TIMESTAMP(3);
