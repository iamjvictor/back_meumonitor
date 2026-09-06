CREATE TYPE "StudentQuestionAttemptMode" AS ENUM ('PRACTICE', 'DAILY_CHALLENGE', 'SIMULATED');

CREATE TABLE "daily_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "monitor_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "challenge_date" DATE NOT NULL,
    "available_from" TIMESTAMPTZ NOT NULL,
    "available_until" TIMESTAMPTZ NOT NULL,
    "selection_strategy" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_question_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "daily_challenge_id" UUID,
    "mode" "StudentQuestionAttemptMode" NOT NULL,
    "selected_answer" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "response_time_ms" INTEGER,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_question_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_challenge_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_challenge_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "question_attempt_id" UUID NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_challenge_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_question_attempts" ADD CONSTRAINT "student_question_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_question_attempts" ADD CONSTRAINT "student_question_attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_question_attempts" ADD CONSTRAINT "student_question_attempts_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_question_attempts" ADD CONSTRAINT "student_question_attempts_daily_challenge_id_fkey" FOREIGN KEY ("daily_challenge_id") REFERENCES "daily_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_challenge_attempts" ADD CONSTRAINT "daily_challenge_attempts_daily_challenge_id_fkey" FOREIGN KEY ("daily_challenge_id") REFERENCES "daily_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_challenge_attempts" ADD CONSTRAINT "daily_challenge_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_challenge_attempts" ADD CONSTRAINT "daily_challenge_attempts_question_attempt_id_fkey" FOREIGN KEY ("question_attempt_id") REFERENCES "student_question_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "daily_challenges_monitor_id_challenge_date_key" ON "daily_challenges"("monitor_id", "challenge_date");
CREATE UNIQUE INDEX "daily_challenges_monitor_id_question_id_key" ON "daily_challenges"("monitor_id", "question_id");
CREATE UNIQUE INDEX "daily_challenge_attempts_daily_challenge_id_student_id_key" ON "daily_challenge_attempts"("daily_challenge_id", "student_id");
CREATE UNIQUE INDEX "daily_challenge_attempts_question_attempt_id_key" ON "daily_challenge_attempts"("question_attempt_id");
CREATE INDEX "daily_challenges_challenge_date_idx" ON "daily_challenges"("challenge_date");
CREATE INDEX "student_question_attempts_student_id_answered_at_idx" ON "student_question_attempts"("student_id", "answered_at");
CREATE INDEX "student_question_attempts_monitor_id_answered_at_idx" ON "student_question_attempts"("monitor_id", "answered_at");
CREATE INDEX "daily_challenge_attempts_student_id_answered_at_idx" ON "daily_challenge_attempts"("student_id", "answered_at");
