ALTER TABLE "teachers"
  DROP CONSTRAINT IF EXISTS "teachers_status_check";

ALTER TABLE "teachers"
  ADD CONSTRAINT "teachers_status_check"
  CHECK ("status" IN ('pending', 'active', 'rejected', 'suspended'));
