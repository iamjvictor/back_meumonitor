CREATE TABLE "stripe_customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "student_id" UUID NOT NULL, "provider" TEXT NOT NULL DEFAULT 'STRIPE',
  "provider_customer_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stripe_customers_pkey" PRIMARY KEY ("id"), CONSTRAINT "stripe_customers_student_id_key" UNIQUE ("student_id"), CONSTRAINT "stripe_customers_provider_customer_id_key" UNIQUE ("provider_customer_id"),
  CONSTRAINT "stripe_customers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "billing_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "student_id" UUID NOT NULL, "customer_id" UUID NOT NULL, "provider_subscription_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "billing_interval" TEXT NOT NULL, "currency" TEXT NOT NULL DEFAULT 'BRL', "subtotal_amount" INTEGER NOT NULL, "discount_amount" INTEGER NOT NULL DEFAULT 0, "total_amount" INTEGER NOT NULL,
  "current_period_start" TIMESTAMP(3) NOT NULL, "current_period_end" TIMESTAMP(3) NOT NULL, "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false, "cancelled_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id"), CONSTRAINT "billing_subscriptions_student_id_key" UNIQUE ("student_id"), CONSTRAINT "billing_subscriptions_provider_subscription_id_key" UNIQUE ("provider_subscription_id"),
  CONSTRAINT "billing_subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "stripe_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "billing_subscription_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "subscription_id" UUID NOT NULL, "monitor_id" UUID NOT NULL, "provider_subscription_item_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "amount_before_discount" INTEGER NOT NULL, "discount_amount" INTEGER NOT NULL DEFAULT 0, "final_amount" INTEGER NOT NULL, "current_period_end" TIMESTAMP(3), "removed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_subscription_items_pkey" PRIMARY KEY ("id"), CONSTRAINT "billing_subscription_items_subscription_id_monitor_id_key" UNIQUE ("subscription_id", "monitor_id"), CONSTRAINT "billing_subscription_items_provider_subscription_item_id_key" UNIQUE ("provider_subscription_item_id"),
  CONSTRAINT "billing_subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_subscription_items_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "student_enrollments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "student_id" UUID NOT NULL, "monitor_id" UUID NOT NULL, "subscription_item_id" UUID, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ends_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id"), CONSTRAINT "student_enrollments_student_id_monitor_id_key" UNIQUE ("student_id", "monitor_id"),
  CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "student_enrollments_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "student_enrollments_subscription_item_id_fkey" FOREIGN KEY ("subscription_item_id") REFERENCES "billing_subscription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "billing_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "provider" TEXT NOT NULL, "provider_event_id" TEXT NOT NULL, "event_type" TEXT NOT NULL, "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'RECEIVED', "processed_at" TIMESTAMP(3), "failure_message" TEXT, "student_id" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id"), CONSTRAINT "billing_webhook_events_provider_provider_event_id_key" UNIQUE ("provider", "provider_event_id"),
  CONSTRAINT "billing_webhook_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "billing_subscriptions_status_idx" ON "billing_subscriptions"("status");
CREATE INDEX "billing_subscription_items_monitor_id_idx" ON "billing_subscription_items"("monitor_id");
CREATE INDEX "student_enrollments_status_idx" ON "student_enrollments"("status");
CREATE INDEX "billing_webhook_events_status_idx" ON "billing_webhook_events"("status");
