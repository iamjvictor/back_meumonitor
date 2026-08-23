CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "custom_area" TEXT,
    "bio" TEXT,
    "page_slug" TEXT NOT NULL,
    "avatar_url" TEXT,
    "instagram" TEXT,
    "tiktok" TEXT,
    "youtube" TEXT,
    "role" TEXT NOT NULL DEFAULT 'teacher',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "terms_accepted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teachers_user_id_key" ON "teachers"("user_id");
CREATE UNIQUE INDEX "teachers_username_key" ON "teachers"("username");
CREATE UNIQUE INDEX "teachers_page_slug_key" ON "teachers"("page_slug");
CREATE INDEX "teachers_user_id_idx" ON "teachers"("user_id");
CREATE INDEX "teachers_status_idx" ON "teachers"("status");

ALTER TABLE "teachers"
  ADD CONSTRAINT "teachers_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'suspended'));
