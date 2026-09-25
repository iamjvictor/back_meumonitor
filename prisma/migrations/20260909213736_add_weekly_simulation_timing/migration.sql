ALTER TABLE "weekly_simulations"
ADD COLUMN "solving_started_at" TIMESTAMPTZ,
ADD COLUMN "deadline_at" TIMESTAMPTZ,
ADD COLUMN "time_limit_seconds" INTEGER NOT NULL DEFAULT 3600,
ADD COLUMN "duration_seconds" INTEGER;
