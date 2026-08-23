CREATE TABLE "question_topics" (
  "question_id" UUID NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "topic_id" UUID NOT NULL REFERENCES "monitor_topics"("id") ON DELETE CASCADE,
  "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("question_id", "topic_id")
);

CREATE INDEX "question_topics_topic_id_question_id_idx"
  ON "question_topics"("topic_id", "question_id");

INSERT INTO "question_topics" ("question_id", "topic_id", "is_primary")
SELECT "id", "topic_id", TRUE
FROM "questions"
WHERE "topic_id" IS NOT NULL
ON CONFLICT ("question_id", "topic_id") DO NOTHING;

ALTER TABLE "question_topics" ENABLE ROW LEVEL SECURITY;
