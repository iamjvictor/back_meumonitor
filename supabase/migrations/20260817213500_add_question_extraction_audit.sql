CREATE TYPE "QuestionKind" AS ENUM ('OPEN_ENDED', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'UNKNOWN');
CREATE TYPE "QuestionAnswerOrigin" AS ENUM ('SOURCE_DOCUMENT', 'TEACHER', 'AI_GENERATED');
CREATE TYPE "QuestionExplanationOrigin" AS ENUM ('SOURCE_DOCUMENT', 'TEACHER', 'AI_GENERATED');

ALTER TABLE "questions"
  ADD COLUMN "kind" "QuestionKind" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "correct_answer_origin" "QuestionAnswerOrigin",
  ADD COLUMN "explanation_origin" "QuestionExplanationOrigin",
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ,
  ADD COLUMN "reviewed_by" UUID;

CREATE INDEX "questions_student_available_idx"
  ON "questions"("monitor_id", "subject_id", "topic_id", "created_at")
  WHERE "status" = 'APPROVED'::"QuestionStatus" AND "correct_answer" IS NOT NULL;
