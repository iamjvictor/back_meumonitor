UPDATE "questions"
SET "statement_origin" = 'RECONSTRUCTED_FROM_DOCUMENT',
    "alternatives_origin" = CASE
      WHEN jsonb_array_length(COALESCE("alternatives", '[]'::jsonb)) > 0
        THEN 'RECONSTRUCTED_FROM_DOCUMENT'::"QuestionContentOrigin"
      ELSE NULL
    END,
    "completeness_status" = CASE
      WHEN "correct_answer" IS NULL OR btrim("correct_answer") = ''
        THEN 'MISSING_ANSWER'::"QuestionCompletenessStatus"
      WHEN jsonb_array_length(COALESCE("alternatives", '[]'::jsonb)) < 2
        AND "kind" IN ('MULTIPLE_CHOICE'::"QuestionKind", 'TRUE_FALSE'::"QuestionKind")
        THEN 'MISSING_ALTERNATIVES'::"QuestionCompletenessStatus"
      WHEN "explanation" IS NULL OR btrim("explanation") = ''
        THEN 'MISSING_EXPLANATION'::"QuestionCompletenessStatus"
      ELSE 'COMPLETE_FROM_SOURCE'::"QuestionCompletenessStatus"
    END,
    "needs_review" = TRUE,
    "status" = CASE
      WHEN "status" = 'APPROVED'::"QuestionStatus" THEN 'PENDING_REVIEW'::"QuestionStatus"
      ELSE "status"
    END;

UPDATE "question_sources"
SET "role" = 'STATEMENT'::"QuestionSourceRole"
WHERE "role" = 'CONTEXT'::"QuestionSourceRole";
