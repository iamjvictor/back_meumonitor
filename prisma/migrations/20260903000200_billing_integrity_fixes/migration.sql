-- Integrity-only migration. No rows are deleted or rewritten.
ALTER TABLE "billing_subscriptions"
  DROP CONSTRAINT IF EXISTS "billing_subscriptions_student_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_student_active_unique"
  ON "billing_subscriptions" ("student_id")
  WHERE "status" IN ('ACTIVE', 'TRIALING');

ALTER TABLE "student_enrollments"
  ALTER COLUMN "subscription_item_id" SET NOT NULL;

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_status_check"
  CHECK ("status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'UNPAID')) NOT VALID;

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_interval_check"
  CHECK ("billing_interval" IN ('MONTH', 'YEAR')) NOT VALID;

ALTER TABLE "billing_subscription_items"
  ADD CONSTRAINT "billing_subscription_items_status_check"
  CHECK ("status" IN ('ACTIVE', 'PENDING_REMOVAL', 'REMOVED')) NOT VALID;

ALTER TABLE "student_enrollments"
  ADD CONSTRAINT "student_enrollments_status_check"
  CHECK ("status" IN ('ACTIVE', 'PENDING_REMOVAL', 'REMOVED')) NOT VALID;

ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_status_check"
  CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'FAILED')) NOT VALID;
