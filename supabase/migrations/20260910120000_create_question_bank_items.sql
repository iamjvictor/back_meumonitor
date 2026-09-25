CREATE TABLE "question_bank_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "provider_question_id" TEXT NOT NULL,
  "external_id" TEXT,
  "exam_type" TEXT NOT NULL,
  "exam_name" TEXT NOT NULL,
  "board" TEXT,
  "institution" TEXT,
  "exam_year" INTEGER,
  "subject" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "subtopic" TEXT,
  "subsubtopic" TEXT,
  "taxonomy_path" JSONB NOT NULL,
  "statement_html" TEXT NOT NULL,
  "statement_text" TEXT NOT NULL,
  "alternatives" JSONB NOT NULL,
  "correct_answer" TEXT NOT NULL,
  "difficulty" TEXT,
  "source_url" TEXT,
  "image_urls" JSONB NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "content_hash" TEXT NOT NULL,
  "explanation" TEXT,
  "explanation_status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  "status" TEXT NOT NULL DEFAULT 'IMPORTED',
  "source_fetched_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "question_bank_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "question_bank_items_provider_question_id_key"
    UNIQUE ("provider", "provider_question_id"),
  CONSTRAINT "question_bank_items_subject_not_empty"
    CHECK (length(btrim("subject")) > 0),
  CONSTRAINT "question_bank_items_topic_not_empty"
    CHECK (length(btrim("topic")) > 0)
);

CREATE INDEX "question_bank_items_exam_board_subject_topic_status_idx"
  ON "question_bank_items"("exam_type", "board", "subject", "topic", "status");

CREATE INDEX "question_bank_items_provider_exam_year_idx"
  ON "question_bank_items"("provider", "exam_year");

CREATE INDEX "question_bank_items_content_hash_idx"
  ON "question_bank_items"("content_hash");

ALTER TABLE "question_bank_items" ENABLE ROW LEVEL SECURITY;
