ALTER TABLE "student_question_attempts"
ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "student_question_attempts_idempotency_key_key"
ON "student_question_attempts"("idempotency_key");
