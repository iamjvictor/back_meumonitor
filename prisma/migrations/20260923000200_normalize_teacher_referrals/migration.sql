-- Move referral ownership out of teachers so non-referred teachers have no
-- artificial default commission.

CREATE TABLE "teacher_referrals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "referred_teacher_id" UUID NOT NULL,
  "indicator_teacher_id" UUID NOT NULL,
  "percentage" DECIMAL(7,4) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_referrals_percentage_check" CHECK ("percentage" BETWEEN 0 AND 100),
  CONSTRAINT "teacher_referrals_not_self_check" CHECK ("referred_teacher_id" <> "indicator_teacher_id")
);

ALTER TABLE "teacher_referrals"
  ADD CONSTRAINT "teacher_referrals_referred_teacher_id_fkey"
  FOREIGN KEY ("referred_teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_referrals"
  ADD CONSTRAINT "teacher_referrals_indicator_teacher_id_fkey"
  FOREIGN KEY ("indicator_teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "teacher_referrals_referred_teacher_id_key"
  ON "teacher_referrals"("referred_teacher_id");
CREATE INDEX "teacher_referrals_indicator_teacher_id_idx"
  ON "teacher_referrals"("indicator_teacher_id");
CREATE INDEX "teacher_referrals_status_idx"
  ON "teacher_referrals"("status");

ALTER TABLE "teachers" DROP CONSTRAINT "teachers_referrer_teacher_id_fkey";
ALTER TABLE "teachers" DROP COLUMN "referral_percentage";
ALTER TABLE "teachers" DROP COLUMN "referrer_teacher_id";
