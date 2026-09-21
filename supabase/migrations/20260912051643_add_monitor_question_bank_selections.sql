CREATE TABLE "monitor_question_bank_selections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "monitor_topic_id" UUID NOT NULL,
  "subtopic" TEXT,
  "subsubtopic" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "monitor_question_bank_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitor_question_bank_selections_topic_fkey"
    FOREIGN KEY ("monitor_topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE,
  CONSTRAINT "monitor_question_bank_selections_subtopic_not_empty"
    CHECK ("subtopic" IS NULL OR length(btrim("subtopic")) > 0),
  CONSTRAINT "monitor_question_bank_selections_subsubtopic_not_empty"
    CHECK ("subsubtopic" IS NULL OR length(btrim("subsubtopic")) > 0),
  CONSTRAINT "monitor_question_bank_selections_subsubtopic_requires_subtopic"
    CHECK ("subsubtopic" IS NULL OR "subtopic" IS NOT NULL)
);

CREATE INDEX "monitor_question_bank_selections_monitor_topic_id_idx"
  ON "monitor_question_bank_selections"("monitor_topic_id");

ALTER TABLE "monitor_question_bank_selections" ENABLE ROW LEVEL SECURITY;
