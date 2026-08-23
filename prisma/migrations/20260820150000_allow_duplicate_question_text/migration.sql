-- Repeated question statements are valid across sources and within a topic.
-- Idempotency is handled by questions.source_key instead.
ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_topic_id_text_hash_key";

DROP INDEX IF EXISTS "questions_topic_id_text_hash_key";
