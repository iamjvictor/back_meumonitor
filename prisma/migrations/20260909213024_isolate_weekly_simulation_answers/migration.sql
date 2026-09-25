ALTER TABLE "weekly_simulation_items"
DROP CONSTRAINT IF EXISTS "weekly_simulation_items_question_attempt_id_fkey";

DROP INDEX IF EXISTS "weekly_simulation_items_question_attempt_id_key";

ALTER TABLE "weekly_simulation_items"
DROP COLUMN IF EXISTS "question_attempt_id",
ADD COLUMN "response_time_ms" INTEGER;
