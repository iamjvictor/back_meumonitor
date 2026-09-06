CREATE INDEX "student_question_attempts_student_answered_desc_idx"
ON "student_question_attempts"("student_id", "answered_at" DESC);
