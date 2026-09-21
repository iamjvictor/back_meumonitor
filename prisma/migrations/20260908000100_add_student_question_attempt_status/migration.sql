CREATE TYPE "StudentQuestionAttemptStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "student_question_attempts"
ADD COLUMN "status" "StudentQuestionAttemptStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "student_question_attempts_student_id_status_answered_at_idx"
ON "student_question_attempts"("student_id", "status", "answered_at");
