-- Asaas checkout MVP: pricing, payout snapshots, provider identities and access bridge.
-- This migration is intentionally additive; legacy Stripe/Billing tables remain intact.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'PayoutMode'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "PayoutMode" AS ENUM ('TEACHER_ACCOUNT', 'PLATFORM_FALLBACK');
  END IF;
END
$$;

ALTER TABLE "teachers"
  ADD COLUMN "teacher_percentage" DECIMAL(7,4) NOT NULL DEFAULT 50,
  ADD COLUMN "referral_percentage" DECIMAL(7,4) NOT NULL DEFAULT 5,
  ADD COLUMN "referrer_teacher_id" UUID,
  ADD COLUMN "current_payment_account_id" UUID;

ALTER TABLE "monitors"
  ADD COLUMN "price_cents" INTEGER NOT NULL DEFAULT 5990,
  ADD COLUMN "allow_publish_without_payment_account" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "student_subscriptions"
  ADD COLUMN "payment_subscription_item_id" UUID,
  ADD COLUMN "last_payment_charge_id" UUID;

ALTER TABLE "student_enrollments"
  ALTER COLUMN "subscription_item_id" DROP NOT NULL,
  ADD COLUMN "payment_subscription_item_id" UUID;

CREATE TABLE "payment_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider" TEXT NOT NULL DEFAULT 'ASAAS',
  "provider_account_id" TEXT,
  "wallet_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "general_status" TEXT,
  "commercial_info_status" TEXT,
  "bank_account_status" TEXT,
  "documentation_status" TEXT,
  "activation_channel" TEXT,
  "onboarding_url" TEXT,
  "credential_ref" TEXT,
  "rejection_reason" TEXT,
  "verified_at" TIMESTAMP(3),
  "last_event_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider" TEXT NOT NULL DEFAULT 'ASAAS',
  "provider_customer_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "customer_id" UUID,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "gross_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "external_reference" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_orders_gross_cents_check" CHECK ("gross_cents" > 0)
);

CREATE TABLE "payment_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "description_snapshot" TEXT NOT NULL,
  "price_cents_snapshot" INTEGER NOT NULL,
  "teacher_percentage_snapshot" DECIMAL(7,4) NOT NULL,
  "referrer_teacher_id_snapshot" UUID,
  "referral_percentage_snapshot" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_order_items_price_check" CHECK ("price_cents_snapshot" > 0),
  CONSTRAINT "payment_order_items_teacher_percentage_check" CHECK ("teacher_percentage_snapshot" BETWEEN 0 AND 100),
  CONSTRAINT "payment_order_items_referral_percentage_check" CHECK ("referral_percentage_snapshot" BETWEEN 0 AND 100),
  CONSTRAINT "payment_order_items_percentage_sum_check" CHECK ("teacher_percentage_snapshot" + "referral_percentage_snapshot" <= 100),
  CONSTRAINT "payment_order_items_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "payment_checkouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider_checkout_id" TEXT,
  "checkout_url" TEXT,
  "external_reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "customer_id" UUID,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider_subscription_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "next_due_date" TIMESTAMP(3),
  "anchor_day" INTEGER,
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "cancelled_at" TIMESTAMP(3),
  "desired_payout_version" INTEGER NOT NULL DEFAULT 1,
  "applied_payout_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_subscription_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID NOT NULL,
  "order_item_id" UUID,
  "student_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "price_cents_snapshot" INTEGER NOT NULL,
  "teacher_percentage_snapshot" DECIMAL(7,4) NOT NULL,
  "referrer_teacher_id_snapshot" UUID,
  "referral_percentage_snapshot" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_subscription_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_subscription_items_price_check" CHECK ("price_cents_snapshot" > 0),
  CONSTRAINT "payment_subscription_items_teacher_percentage_check" CHECK ("teacher_percentage_snapshot" BETWEEN 0 AND 100),
  CONSTRAINT "payment_subscription_items_referral_percentage_check" CHECK ("referral_percentage_snapshot" BETWEEN 0 AND 100),
  CONSTRAINT "payment_subscription_items_percentage_sum_check" CHECK ("teacher_percentage_snapshot" + "referral_percentage_snapshot" <= 100)
);

CREATE TABLE "payment_charges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider_payment_id" TEXT NOT NULL,
  "provider_checkout_id" TEXT,
  "due_date" TIMESTAMP(3),
  "service_period_start" TIMESTAMP(3),
  "service_period_end" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "gross_cents" INTEGER NOT NULL,
  "net_cents" INTEGER,
  "fee_cents" INTEGER,
  "confirmed_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "applied_payout_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_charges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_charges_gross_cents_check" CHECK ("gross_cents" > 0)
);

CREATE TABLE "payment_splits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "charge_id" UUID NOT NULL,
  "order_item_id" UUID,
  "account_revision_id" UUID,
  "provider_split_id" TEXT,
  "role" TEXT NOT NULL,
  "wallet_id" TEXT,
  "destination" TEXT NOT NULL DEFAULT 'PLATFORM',
  "payout_mode" "PayoutMode" NOT NULL DEFAULT 'PLATFORM_FALLBACK',
  "contracted_percentage" DECIMAL(7,4) NOT NULL,
  "effective_percentage" DECIMAL(7,4) NOT NULL,
  "expected_cents" INTEGER,
  "settled_cents" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "fallback_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_splits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_splits_contracted_percentage_check" CHECK ("contracted_percentage" BETWEEN 0 AND 100),
  CONSTRAINT "payment_splits_effective_percentage_check" CHECK ("effective_percentage" BETWEEN 0 AND 100)
);

CREATE TABLE "payment_idempotency_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "resource_id" UUID,
  "state" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "provider_account_id" TEXT,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "lease_until" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "failure_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_audit_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "database_actor" TEXT,
  "origin" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "teacher_id" UUID,
  "monitor_id" UUID,
  "student_id" UUID,
  "before" JSONB,
  "after" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_audit_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_access_payment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" TEXT NOT NULL,
  "student_id" UUID NOT NULL,
  "charge_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_access_payment_events_pkey" PRIMARY KEY ("id")
);

-- PostgreSQL requires the referenced provider identity to be unique before
-- creating the webhook-event foreign key below.
CREATE UNIQUE INDEX "payment_accounts_provider_account_id_key"
  ON "payment_accounts"("provider_account_id");
CREATE UNIQUE INDEX "payment_accounts_wallet_id_key"
  ON "payment_accounts"("wallet_id");

ALTER TABLE "teachers" ADD CONSTRAINT "teachers_referrer_teacher_id_fkey"
  FOREIGN KEY ("referrer_teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_current_payment_account_id_fkey"
  FOREIGN KEY ("current_payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "payment_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_order_items" ADD CONSTRAINT "payment_order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_order_items" ADD CONSTRAINT "payment_order_items_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_order_items" ADD CONSTRAINT "payment_order_items_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_subscriptions" ADD CONSTRAINT "payment_subscriptions_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_subscriptions" ADD CONSTRAINT "payment_subscriptions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_subscriptions" ADD CONSTRAINT "payment_subscriptions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "payment_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_subscription_items" ADD CONSTRAINT "payment_subscription_items_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "payment_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_subscription_items" ADD CONSTRAINT "payment_subscription_items_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "payment_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_subscription_items" ADD CONSTRAINT "payment_subscription_items_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_subscription_items" ADD CONSTRAINT "payment_subscription_items_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_subscription_items" ADD CONSTRAINT "payment_subscription_items_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "payment_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_splits" ADD CONSTRAINT "payment_splits_charge_id_fkey"
  FOREIGN KEY ("charge_id") REFERENCES "payment_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_splits" ADD CONSTRAINT "payment_splits_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "payment_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_splits" ADD CONSTRAINT "payment_splits_account_revision_id_fkey"
  FOREIGN KEY ("account_revision_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_idempotency_keys" ADD CONSTRAINT "payment_idempotency_keys_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_provider_account_id_fkey"
  FOREIGN KEY ("provider_account_id") REFERENCES "payment_accounts"("provider_account_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_audit_entries" ADD CONSTRAINT "payment_audit_entries_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_audit_entries" ADD CONSTRAINT "payment_audit_entries_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_audit_entries" ADD CONSTRAINT "payment_audit_entries_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_access_payment_events" ADD CONSTRAINT "student_access_payment_events_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_payment_subscription_item_id_fkey"
  FOREIGN KEY ("payment_subscription_item_id") REFERENCES "payment_subscription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_last_payment_charge_id_fkey"
  FOREIGN KEY ("last_payment_charge_id") REFERENCES "payment_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_payment_subscription_item_id_fkey"
  FOREIGN KEY ("payment_subscription_item_id") REFERENCES "payment_subscription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "payment_accounts_teacher_id_environment_revision_key" ON "payment_accounts"("teacher_id", "environment", "revision");
CREATE UNIQUE INDEX "payment_customers_student_id_environment_key" ON "payment_customers"("student_id", "environment");
CREATE UNIQUE INDEX "payment_customers_environment_provider_customer_id_key" ON "payment_customers"("environment", "provider_customer_id");
CREATE UNIQUE INDEX "payment_orders_environment_external_reference_key" ON "payment_orders"("environment", "external_reference");
CREATE UNIQUE INDEX "payment_order_items_order_id_monitor_id_key" ON "payment_order_items"("order_id", "monitor_id");
CREATE UNIQUE INDEX "payment_checkouts_environment_provider_checkout_id_key" ON "payment_checkouts"("environment", "provider_checkout_id");
CREATE UNIQUE INDEX "payment_checkouts_environment_external_reference_attempt_key" ON "payment_checkouts"("environment", "external_reference", "attempt");
CREATE UNIQUE INDEX "payment_subscriptions_order_id_key" ON "payment_subscriptions"("order_id");
CREATE UNIQUE INDEX "payment_subscriptions_environment_provider_subscription_id_key" ON "payment_subscriptions"("environment", "provider_subscription_id");
CREATE UNIQUE INDEX "payment_subscription_items_subscription_id_monitor_id_key" ON "payment_subscription_items"("subscription_id", "monitor_id");
CREATE UNIQUE INDEX "payment_charges_environment_provider_payment_id_key" ON "payment_charges"("environment", "provider_payment_id");
CREATE UNIQUE INDEX "payment_splits_charge_id_role_wallet_id_key" ON "payment_splits"("charge_id", "role", "wallet_id");
CREATE UNIQUE INDEX "payment_idempotency_keys_student_id_operation_key_key" ON "payment_idempotency_keys"("student_id", "operation", "key");
CREATE UNIQUE INDEX "payment_webhook_events_environment_provider_account_id_provider_event_id_key" ON "payment_webhook_events"("environment", "provider_account_id", "provider_event_id");
CREATE UNIQUE INDEX "payment_outbox_events_event_id_key" ON "payment_outbox_events"("event_id");
CREATE UNIQUE INDEX "student_access_payment_events_event_id_key" ON "student_access_payment_events"("event_id");
CREATE UNIQUE INDEX "student_subscriptions_payment_subscription_item_id_key" ON "student_subscriptions"("payment_subscription_item_id");
CREATE UNIQUE INDEX "student_enrollments_payment_subscription_item_id_key" ON "student_enrollments"("payment_subscription_item_id");

CREATE INDEX "payment_accounts_environment_provider_account_id_idx" ON "payment_accounts"("environment", "provider_account_id");
CREATE INDEX "payment_accounts_environment_wallet_id_idx" ON "payment_accounts"("environment", "wallet_id");
CREATE INDEX "payment_accounts_teacher_id_status_idx" ON "payment_accounts"("teacher_id", "status");
CREATE INDEX "payment_accounts_environment_status_idx" ON "payment_accounts"("environment", "status");
CREATE INDEX "payment_customers_student_id_idx" ON "payment_customers"("student_id");
CREATE INDEX "payment_orders_student_id_status_idx" ON "payment_orders"("student_id", "status");
CREATE INDEX "payment_orders_customer_id_idx" ON "payment_orders"("customer_id");
CREATE INDEX "payment_order_items_monitor_id_idx" ON "payment_order_items"("monitor_id");
CREATE INDEX "payment_order_items_teacher_id_idx" ON "payment_order_items"("teacher_id");
CREATE INDEX "payment_checkouts_order_id_status_idx" ON "payment_checkouts"("order_id", "status");
CREATE INDEX "payment_subscriptions_student_id_status_idx" ON "payment_subscriptions"("student_id", "status");
CREATE INDEX "payment_subscriptions_customer_id_idx" ON "payment_subscriptions"("customer_id");
CREATE INDEX "payment_subscription_items_student_id_monitor_id_status_idx" ON "payment_subscription_items"("student_id", "monitor_id", "status");
CREATE INDEX "payment_subscription_items_teacher_id_idx" ON "payment_subscription_items"("teacher_id");
CREATE INDEX "payment_charges_subscription_id_status_idx" ON "payment_charges"("subscription_id", "status");
CREATE INDEX "payment_charges_provider_checkout_id_idx" ON "payment_charges"("provider_checkout_id");
CREATE INDEX "payment_splits_account_revision_id_status_idx" ON "payment_splits"("account_revision_id", "status");
CREATE INDEX "payment_splits_charge_id_status_idx" ON "payment_splits"("charge_id", "status");
CREATE INDEX "payment_idempotency_keys_resource_id_idx" ON "payment_idempotency_keys"("resource_id");
CREATE INDEX "payment_webhook_events_state_next_attempt_at_idx" ON "payment_webhook_events"("state", "next_attempt_at");
CREATE INDEX "payment_webhook_events_event_type_idx" ON "payment_webhook_events"("event_type");
CREATE INDEX "payment_outbox_events_state_next_attempt_at_idx" ON "payment_outbox_events"("state", "next_attempt_at");
CREATE INDEX "payment_outbox_events_aggregate_id_version_idx" ON "payment_outbox_events"("aggregate_id", "version");
CREATE INDEX "payment_audit_entries_teacher_id_occurred_at_idx" ON "payment_audit_entries"("teacher_id", "occurred_at");
CREATE INDEX "payment_audit_entries_monitor_id_occurred_at_idx" ON "payment_audit_entries"("monitor_id", "occurred_at");
CREATE INDEX "payment_audit_entries_student_id_occurred_at_idx" ON "payment_audit_entries"("student_id", "occurred_at");
CREATE INDEX "student_access_payment_events_student_id_processed_at_idx" ON "student_access_payment_events"("student_id", "processed_at");
CREATE INDEX "student_access_payment_events_charge_id_idx" ON "student_access_payment_events"("charge_id");

ALTER TABLE "student_enrollments"
  ADD CONSTRAINT "student_enrollments_one_payment_bridge_check"
  CHECK (("subscription_item_id" IS NOT NULL) OR ("payment_subscription_item_id" IS NOT NULL)) NOT VALID;

-- Financial/provider tables are only accessed through the backend service layer.
-- Enabling RLS prevents accidental exposure through Supabase's data APIs.
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_checkouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_subscription_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_splits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_access_payment_events" ENABLE ROW LEVEL SECURITY;
