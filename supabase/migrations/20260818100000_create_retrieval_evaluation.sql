CREATE TABLE "retrieval_eval_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "monitor_id" UUID NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
  "subject_id" UUID NOT NULL REFERENCES "monitor_subjects"("id") ON DELETE CASCADE,
  "question" TEXT NOT NULL,
  "expected_block_ids" JSONB NOT NULL,
  "expected_chunk_ids" JSONB,
  "expected_answer_contains" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "retrieval_eval_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retrieval_eval_cases_monitor_id_subject_id_active_idx"
  ON "retrieval_eval_cases"("monitor_id", "subject_id", "active");

CREATE TABLE "retrieval_eval_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL REFERENCES "retrieval_eval_cases"("id") ON DELETE CASCADE,
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

CREATE INDEX "retrieval_eval_runs_case_id_created_at_idx"
  ON "retrieval_eval_runs"("case_id", "created_at");

ALTER TABLE "retrieval_eval_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retrieval_eval_runs" ENABLE ROW LEVEL SECURITY;
