CREATE TYPE "FlashcardKind" AS ENUM ('DEFINITION', 'FORMULA', 'RULE', 'EXCEPTION', 'APPLICATION');
CREATE TYPE "FlashcardDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');
CREATE TYPE "FlashcardGenerationOrigin" AS ENUM ('SOURCE_DOCUMENT', 'AI_GENERATED', 'TEACHER');
CREATE TYPE "FlashcardStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

CREATE TABLE "flashcards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "topic_id" UUID NOT NULL,
  "front" TEXT NOT NULL,
  "back" TEXT NOT NULL,
  "kind" "FlashcardKind" NOT NULL,
  "difficulty" "FlashcardDifficulty",
  "generation_origin" "FlashcardGenerationOrigin" NOT NULL,
  "status" "FlashcardStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "front_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "flashcards_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
  CONSTRAINT "flashcards_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE,
  CONSTRAINT "flashcards_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "monitor_subjects"("id") ON DELETE CASCADE,
  CONSTRAINT "flashcards_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "monitor_topics"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "flashcards_topic_id_front_hash_key" ON "flashcards"("topic_id", "front_hash");
CREATE INDEX "flashcards_monitor_id_subject_id_topic_id_status_idx" ON "flashcards"("monitor_id", "subject_id", "topic_id", "status");

CREATE TABLE "flashcard_sources" (
  "flashcard_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "flashcard_sources_pkey" PRIMARY KEY ("flashcard_id", "chunk_id"),
  CONSTRAINT "flashcard_sources_flashcard_id_fkey" FOREIGN KEY ("flashcard_id") REFERENCES "flashcards"("id") ON DELETE CASCADE,
  CONSTRAINT "flashcard_sources_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "document_chunks"("id") ON DELETE CASCADE
);

CREATE INDEX "flashcard_sources_chunk_id_flashcard_id_idx" ON "flashcard_sources"("chunk_id", "flashcard_id");
ALTER TABLE "flashcards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flashcard_sources" ENABLE ROW LEVEL SECURITY;
