CREATE TABLE "retrieval_eval_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "question" TEXT NOT NULL,
  "expected_block_ids" JSONB NOT NULL,
  "expected_chunk_ids" JSONB,
  "expected_answer_contains" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "retrieval_eval_cases_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "retrieval_eval_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "top_k" INTEGER NOT NULL,
  "returned_block_ids" JSONB NOT NULL,
  "returned_chunk_ids" JSONB NOT NULL,
  "recall_at_k" DOUBLE PRECISION NOT NULL,
  "reciprocal_rank" DOUBLE PRECISION NOT NULL,
  "context_precision" DOUBLE PRECISION,
  "duration_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "retrieval_eval_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "retrieval_eval_cases_monitor_id_subject_id_active_idx" ON "retrieval_eval_cases"("monitor_id", "subject_id", "active");
CREATE INDEX "retrieval_eval_runs_case_id_created_at_idx" ON "retrieval_eval_runs"("case_id", "created_at");
