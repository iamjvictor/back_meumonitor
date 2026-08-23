CREATE TYPE "MonitorStatus" AS ENUM ('DRAFT', 'READY_TO_PUBLISH', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

CREATE TABLE "monitors" (
  "id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "MonitorStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monitors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitors_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "monitor_subjects" (
  "id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monitor_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitor_subjects_monitor_id_fkey"
    FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "monitor_topics" (
  "id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monitor_topics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitor_topics_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "monitor_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "monitors_teacher_id_status_idx" ON "monitors"("teacher_id", "status");
CREATE UNIQUE INDEX "monitor_subjects_monitor_id_name_key" ON "monitor_subjects"("monitor_id", "name");
CREATE UNIQUE INDEX "monitor_subjects_monitor_id_position_key" ON "monitor_subjects"("monitor_id", "position");
CREATE UNIQUE INDEX "monitor_topics_subject_id_name_key" ON "monitor_topics"("subject_id", "name");
CREATE UNIQUE INDEX "monitor_topics_subject_id_position_key" ON "monitor_topics"("subject_id", "position");

ALTER TABLE "monitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitor_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitor_topics" ENABLE ROW LEVEL SECURITY;
