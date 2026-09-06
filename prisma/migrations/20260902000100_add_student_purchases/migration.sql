CREATE TYPE "StudentPurchaseStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'EXPIRED');
CREATE TYPE "StudentPurchasePaymentMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'BOLETO', 'OTHER');

CREATE TABLE "student_purchases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "status" "StudentPurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "payment_method" "StudentPurchasePaymentMethod" NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "subtotal_amount" INTEGER NOT NULL,
  "discount_amount" INTEGER NOT NULL DEFAULT 0,
  "total_amount" INTEGER NOT NULL,
  "gateway" TEXT,
  "gateway_checkout_id" TEXT,
  "gateway_payment_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "paid_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_purchase_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_id" UUID NOT NULL,
  "monitor_id" UUID NOT NULL,
  "description_snapshot" TEXT NOT NULL,
  "unit_amount" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "subscription_months" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_purchase_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "student_subscriptions"
  ADD COLUMN "purchase_id" UUID,
  ADD COLUMN "last_payment_id" UUID,
  ADD COLUMN "gateway_subscription_id" TEXT,
  ADD COLUMN "current_period_start" TIMESTAMP(3),
  ADD COLUMN "current_period_end" TIMESTAMP(3),
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancelled_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "student_purchases_gateway_payment_id_key" ON "student_purchases"("gateway_payment_id");
CREATE UNIQUE INDEX "student_purchases_idempotency_key_key" ON "student_purchases"("idempotency_key");
CREATE INDEX "student_purchases_student_id_status_idx" ON "student_purchases"("student_id", "status");
CREATE INDEX "student_purchases_gateway_checkout_id_idx" ON "student_purchases"("gateway_checkout_id");
CREATE UNIQUE INDEX "student_purchase_items_purchase_id_monitor_id_key" ON "student_purchase_items"("purchase_id", "monitor_id");
CREATE INDEX "student_purchase_items_monitor_id_idx" ON "student_purchase_items"("monitor_id");

ALTER TABLE "student_purchases" ADD CONSTRAINT "student_purchases_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_purchase_items" ADD CONSTRAINT "student_purchase_items_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "student_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_purchase_items" ADD CONSTRAINT "student_purchase_items_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "student_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_last_payment_id_fkey"
  FOREIGN KEY ("last_payment_id") REFERENCES "student_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
