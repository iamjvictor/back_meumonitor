CREATE TABLE "billing_subscription_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "subscription_id" UUID NOT NULL, "student_id" UUID NOT NULL,
  "type" TEXT NOT NULL, "monitor_id" UUID, "from_interval" TEXT, "to_interval" TEXT, "amount" INTEGER,
  "operation_key" TEXT NOT NULL, "metadata" JSONB, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_subscription_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_subscription_changes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE,
  CONSTRAINT "billing_subscription_changes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "billing_subscription_changes_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "billing_subscription_changes_operation_key_key" ON "billing_subscription_changes"("operation_key");
CREATE INDEX "billing_subscription_changes_student_id_created_at_idx" ON "billing_subscription_changes"("student_id", "created_at");
CREATE INDEX "billing_subscription_changes_subscription_id_created_at_idx" ON "billing_subscription_changes"("subscription_id", "created_at");
