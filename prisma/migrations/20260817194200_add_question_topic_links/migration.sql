CREATE TABLE IF NOT EXISTS "question_topics" (
    "question_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_topics_pkey" PRIMARY KEY ("question_id", "topic_id")
);

CREATE INDEX IF NOT EXISTS "question_topics_topic_id_question_id_idx"
ON "question_topics"("topic_id", "question_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'question_topics_question_id_fkey'
      AND conrelid = 'question_topics'::regclass
  ) THEN
    ALTER TABLE "question_topics"
      ADD CONSTRAINT "question_topics_question_id_fkey"
      FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'question_topics_topic_id_fkey'
      AND conrelid = 'question_topics'::regclass
  ) THEN
    ALTER TABLE "question_topics"
      ADD CONSTRAINT "question_topics_topic_id_fkey"
      FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "question_topics" ("question_id", "topic_id", "is_primary")
SELECT "id", "topic_id", true
FROM "questions"
WHERE "topic_id" IS NOT NULL
ON CONFLICT ("question_id", "topic_id") DO NOTHING;
