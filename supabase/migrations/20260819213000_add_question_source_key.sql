ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS source_key TEXT;

UPDATE public.questions
SET source_key = 'legacy:' || id::text
WHERE source_key IS NULL;

ALTER TABLE public.questions
  ALTER COLUMN source_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS questions_source_key_key
  ON public.questions (source_key);
