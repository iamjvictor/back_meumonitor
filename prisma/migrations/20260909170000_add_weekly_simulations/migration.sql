CREATE TYPE "WeeklySimulationStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

CREATE TYPE "WeeklySelectionPriority" AS ENUM ('NEVER_ANSWERED', 'PREVIOUSLY_INCORRECT', 'PREVIOUSLY_CORRECT');

CREATE TABLE "weekly_simulations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "cycle_start_date" DATE NOT NULL,
    "status" "WeeklySimulationStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "generation_job_id" TEXT,
    "question_count" INTEGER NOT NULL DEFAULT 0,
    "answered_count" INTEGER NOT NULL DEFAULT 0,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "score_percent" DOUBLE PRECISION,
    "diagnostic_snapshot" JSONB,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weekly_simulations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "weekly_simulation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "simulation_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "subject_id" UUID NOT NULL,
    "topic_id" UUID,
    "difficulty_score" DOUBLE PRECISION NOT NULL,
    "selection_priority" "WeeklySelectionPriority" NOT NULL,
    "selection_reason" TEXT NOT NULL,
    "question_attempt_id" UUID,
    "selected_answer" TEXT,
    "is_correct" BOOLEAN,
    "answered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weekly_simulation_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "weekly_simulations" ADD CONSTRAINT "weekly_simulations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_simulations" ADD CONSTRAINT "weekly_simulations_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_simulation_items" ADD CONSTRAINT "weekly_simulation_items_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "weekly_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_simulation_items" ADD CONSTRAINT "weekly_simulation_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weekly_simulation_items" ADD CONSTRAINT "weekly_simulation_items_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "monitor_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weekly_simulation_items" ADD CONSTRAINT "weekly_simulation_items_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_simulation_items" ADD CONSTRAINT "weekly_simulation_items_question_attempt_id_fkey" FOREIGN KEY ("question_attempt_id") REFERENCES "student_question_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "weekly_simulations_generation_job_id_key" ON "weekly_simulations"("generation_job_id");
CREATE UNIQUE INDEX "weekly_simulations_student_id_monitor_id_cycle_start_date_key" ON "weekly_simulations"("student_id", "monitor_id", "cycle_start_date");
CREATE UNIQUE INDEX "weekly_simulation_items_simulation_id_question_id_key" ON "weekly_simulation_items"("simulation_id", "question_id");
CREATE UNIQUE INDEX "weekly_simulation_items_simulation_id_position_key" ON "weekly_simulation_items"("simulation_id", "position");
CREATE UNIQUE INDEX "weekly_simulation_items_question_attempt_id_key" ON "weekly_simulation_items"("question_attempt_id");

CREATE INDEX "weekly_simulations_student_id_monitor_id_status_idx" ON "weekly_simulations"("student_id", "monitor_id", "status");
CREATE INDEX "weekly_simulations_monitor_id_cycle_start_date_idx" ON "weekly_simulations"("monitor_id", "cycle_start_date");
CREATE INDEX "weekly_simulation_items_simulation_id_topic_id_idx" ON "weekly_simulation_items"("simulation_id", "topic_id");
