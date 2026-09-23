BEGIN;

-- Normalize the monitor taxonomy while keeping MonitorTopic as the stable root
-- used by existing consumers of Question.topicId and document/topic links.

CREATE TABLE public.monitor_subtopics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_topic_id uuid NOT NULL REFERENCES public.monitor_topics(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitor_subtopics_topic_name_key UNIQUE (monitor_topic_id, name),
  CONSTRAINT monitor_subtopics_topic_position_key UNIQUE (monitor_topic_id, position)
);

CREATE INDEX monitor_subtopics_monitor_topic_id_idx
  ON public.monitor_subtopics (monitor_topic_id);

CREATE TABLE public.monitor_subsubtopics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_subtopic_id uuid NOT NULL REFERENCES public.monitor_subtopics(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitor_subsubtopics_subtopic_name_key UNIQUE (monitor_subtopic_id, name),
  CONSTRAINT monitor_subsubtopics_subtopic_position_key UNIQUE (monitor_subtopic_id, position)
);

CREATE INDEX monitor_subsubtopics_monitor_subtopic_id_idx
  ON public.monitor_subsubtopics (monitor_subtopic_id);

ALTER TABLE public.monitor_question_bank_selections
  ADD COLUMN monitor_subtopic_id uuid REFERENCES public.monitor_subtopics(id) ON DELETE CASCADE,
  ADD COLUMN monitor_subsubtopic_id uuid REFERENCES public.monitor_subsubtopics(id) ON DELETE CASCADE;

ALTER TABLE public.questions
  ADD COLUMN subtopic_id uuid REFERENCES public.monitor_subtopics(id) ON DELETE SET NULL,
  ADD COLUMN subsubtopic_id uuid REFERENCES public.monitor_subsubtopics(id) ON DELETE SET NULL;

CREATE INDEX monitor_question_bank_selections_subtopic_id_idx
  ON public.monitor_question_bank_selections (monitor_subtopic_id);

CREATE INDEX monitor_question_bank_selections_subsubtopic_id_idx
  ON public.monitor_question_bank_selections (monitor_subsubtopic_id);

CREATE INDEX questions_subtopic_id_idx
  ON public.questions (subtopic_id);

CREATE INDEX questions_subsubtopic_id_idx
  ON public.questions (subsubtopic_id);

DO $$
DECLARE
  existing_monitor_topics bigint;
BEGIN
  SELECT count(*) INTO existing_monitor_topics FROM public.monitor_topics;

  IF existing_monitor_topics > 0 THEN
    CREATE TEMP TABLE monitor_topic_hierarchy_map (
      old_topic_id uuid PRIMARY KEY,
      subject_id uuid NOT NULL,
      root_name text NOT NULL,
      subtopic_name text,
      subsubtopic_name text,
      root_topic_id uuid,
      subtopic_id uuid,
      subsubtopic_id uuid
    ) ON COMMIT DROP;

    INSERT INTO monitor_topic_hierarchy_map (
      old_topic_id,
      subject_id,
      root_name,
      subtopic_name,
      subsubtopic_name
    )
    SELECT
      topic.id,
      topic.subject_id,
      btrim(path[1]),
      CASE WHEN cardinality(path) >= 2 THEN nullif(btrim(path[2]), '') END,
      CASE WHEN cardinality(path) >= 3 THEN nullif(btrim(array_to_string(path[3:cardinality(path)], ' > ')), '') END
    FROM public.monitor_topics topic
    CROSS JOIN LATERAL string_to_array(topic.name, ' > ') path;

    WITH root_candidates AS (
      SELECT
        map.subject_id,
        map.root_name,
        max(old_topic.definition) AS definition,
        row_number() OVER (PARTITION BY map.subject_id ORDER BY min(old_topic.position), map.root_name) AS root_rank
      FROM monitor_topic_hierarchy_map map
      JOIN public.monitor_topics old_topic ON old_topic.id = map.old_topic_id
      GROUP BY map.subject_id, map.root_name
    ), subject_positions AS (
      SELECT subject_id, coalesce(max(position), -1) AS max_position
      FROM public.monitor_topics
      GROUP BY subject_id
    )
    INSERT INTO public.monitor_topics (id, subject_id, name, definition, position, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      candidate.subject_id,
      candidate.root_name,
      candidate.definition,
      positions.max_position + candidate.root_rank,
      now(),
      now()
    FROM root_candidates candidate
    JOIN subject_positions positions ON positions.subject_id = candidate.subject_id
    ON CONFLICT (subject_id, name) DO NOTHING;

    UPDATE monitor_topic_hierarchy_map map
    SET root_topic_id = root.id
    FROM public.monitor_topics root
    WHERE root.subject_id = map.subject_id
      AND root.name = map.root_name;

    WITH subtopic_candidates AS (
      SELECT
        root_topic_id,
        subtopic_name,
        row_number() OVER (PARTITION BY root_topic_id ORDER BY subtopic_name) - 1 AS subtopic_position
      FROM monitor_topic_hierarchy_map
      WHERE subtopic_name IS NOT NULL
      GROUP BY root_topic_id, subtopic_name
    )
    INSERT INTO public.monitor_subtopics (id, monitor_topic_id, name, position)
    SELECT gen_random_uuid(), root_topic_id, subtopic_name, subtopic_position
    FROM subtopic_candidates
    ON CONFLICT (monitor_topic_id, name) DO NOTHING;

    UPDATE monitor_topic_hierarchy_map map
    SET subtopic_id = subtopic.id
    FROM public.monitor_subtopics subtopic
    WHERE subtopic.monitor_topic_id = map.root_topic_id
      AND subtopic.name = map.subtopic_name;

    WITH subsubtopic_candidates AS (
      SELECT
        subtopic_id,
        subsubtopic_name,
        row_number() OVER (PARTITION BY subtopic_id ORDER BY subsubtopic_name) - 1 AS subsubtopic_position
      FROM monitor_topic_hierarchy_map
      WHERE subtopic_id IS NOT NULL
        AND subsubtopic_name IS NOT NULL
      GROUP BY subtopic_id, subsubtopic_name
    )
    INSERT INTO public.monitor_subsubtopics (id, monitor_subtopic_id, name, position)
    SELECT gen_random_uuid(), subtopic_id, subsubtopic_name, subsubtopic_position
    FROM subsubtopic_candidates
    ON CONFLICT (monitor_subtopic_id, name) DO NOTHING;

    UPDATE monitor_topic_hierarchy_map map
    SET subsubtopic_id = subsubtopic.id
    FROM public.monitor_subsubtopics subsubtopic
    WHERE subsubtopic.monitor_subtopic_id = map.subtopic_id
      AND subsubtopic.name = map.subsubtopic_name;

    UPDATE public.monitor_documents document
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE document.topic_id = map.old_topic_id;

    UPDATE public.monitor_document_topics link
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE link.topic_id = map.old_topic_id;

    UPDATE public.document_block_topics link
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE link.topic_id = map.old_topic_id;

    UPDATE public.document_chunk_topics link
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE link.topic_id = map.old_topic_id;

    UPDATE public.questions question
    SET
      topic_id = map.root_topic_id,
      subtopic_id = map.subtopic_id,
      subsubtopic_id = map.subsubtopic_id
    FROM monitor_topic_hierarchy_map map
    WHERE question.topic_id = map.old_topic_id;

    UPDATE public.question_topics link
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE link.topic_id = map.old_topic_id;

    UPDATE public.flashcards flashcard
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE flashcard.topic_id = map.old_topic_id;

    UPDATE public.weekly_simulation_items item
    SET topic_id = map.root_topic_id
    FROM monitor_topic_hierarchy_map map
    WHERE item.topic_id = map.old_topic_id;

    UPDATE public.monitor_question_bank_selections selection
    SET
      monitor_topic_id = map.root_topic_id,
      monitor_subtopic_id = map.subtopic_id,
      monitor_subsubtopic_id = map.subsubtopic_id
    FROM monitor_topic_hierarchy_map map
    WHERE selection.monitor_topic_id = map.old_topic_id;

    DELETE FROM public.monitor_topics topic
    USING monitor_topic_hierarchy_map map
    WHERE topic.id = map.old_topic_id
      AND topic.id <> map.root_topic_id;
  END IF;
END $$;

COMMIT;
