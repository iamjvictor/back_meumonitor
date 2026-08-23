CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

CREATE TABLE "question_categories" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "topic_id" UUID NOT NULL REFERENCES "monitor_topics"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("topic_id", "name")
);

CREATE INDEX "question_categories_topic_id_idx" ON "question_categories"("topic_id");

CREATE TABLE "questions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "monitor_id" UUID NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
  "subject_id" UUID NOT NULL REFERENCES "monitor_subjects"("id") ON DELETE CASCADE,
  "topic_id" UUID NOT NULL REFERENCES "monitor_topics"("id") ON DELETE CASCADE,
  "category_id" UUID REFERENCES "question_categories"("id") ON DELETE SET NULL,
  "text" TEXT NOT NULL,
  "alternatives" JSONB NOT NULL,
  "correct_answer" TEXT,
  "explanation" TEXT,
  "text_hash" TEXT NOT NULL,
  "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "embedding" extensions.vector(2048),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("topic_id", "text_hash")
);

CREATE INDEX "questions_monitor_id_subject_id_topic_id_status_idx"
  ON "questions"("monitor_id", "subject_id", "topic_id", "status");
CREATE INDEX "questions_category_id_status_idx"
  ON "questions"("category_id", "status");
CREATE INDEX "questions_embedding_hnsw_idx"
  ON "questions"
  USING hnsw (("embedding"::extensions.halfvec(2048)) extensions.halfvec_cosine_ops)
  WHERE "embedding" IS NOT NULL;

CREATE TABLE "question_sources" (
  "question_id" UUID NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "chunk_id" UUID NOT NULL REFERENCES "document_chunks"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("question_id", "chunk_id")
);

CREATE INDEX "question_sources_chunk_id_question_id_idx"
  ON "question_sources"("chunk_id", "question_id");

ALTER TABLE "question_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_sources" ENABLE ROW LEVEL SECURITY;
