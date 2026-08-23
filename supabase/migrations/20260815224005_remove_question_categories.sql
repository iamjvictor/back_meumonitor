DO $$
BEGIN
  IF to_regclass('public.questions') IS NOT NULL THEN
    ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_category_id_fkey";
    DROP INDEX IF EXISTS "questions_category_id_status_idx";
    ALTER TABLE "questions" DROP COLUMN IF EXISTS "category_id";
  END IF;
END $$;

DROP TABLE IF EXISTS "question_categories";
