ALTER TABLE "monitor_question_bank_selections"
  ADD COLUMN "exam_type" TEXT,
  ADD COLUMN "board" TEXT,
  ADD COLUMN "selection_key" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "monitor_question_bank_selections"
    WHERE "exam_type" IS NULL OR "selection_key" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot make question-bank selection profile fields required while legacy rows are present';
  END IF;
END $$;

ALTER TABLE "monitor_question_bank_selections"
  ALTER COLUMN "exam_type" SET NOT NULL,
  ALTER COLUMN "selection_key" SET NOT NULL;

ALTER TABLE "monitor_question_bank_selections"
  ADD CONSTRAINT "monitor_question_bank_selections_exam_type_not_empty"
    CHECK (length(btrim("exam_type")) > 0),
  ADD CONSTRAINT "monitor_question_bank_selections_board_not_empty"
    CHECK ("board" IS NULL OR length(btrim("board")) > 0),
  ADD CONSTRAINT "monitor_question_bank_selections_selection_key_not_empty"
    CHECK (length(btrim("selection_key")) > 0);

ALTER TABLE "monitor_question_bank_selections"
  ADD CONSTRAINT "monitor_question_bank_selections_topic_selection_key_key"
    UNIQUE ("monitor_topic_id", "selection_key");

CREATE INDEX "monitor_question_bank_selections_topic_exam_board_idx"
  ON "monitor_question_bank_selections"("monitor_topic_id", "exam_type", "board");

ALTER TABLE "questions"
  ADD COLUMN "question_bank_item_id" UUID;

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_question_bank_item_id_fkey"
    FOREIGN KEY ("question_bank_item_id")
    REFERENCES "question_bank_items"("id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "questions_monitor_id_question_bank_item_id_key"
  ON "questions"("monitor_id", "question_bank_item_id");

CREATE INDEX "questions_question_bank_item_id_idx"
  ON "questions"("question_bank_item_id");
