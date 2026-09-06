CREATE TABLE "student_payment_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchase_id" UUID NOT NULL, "student_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL, "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_payment_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "student_payment_sessions_token_hash_key" ON "student_payment_sessions"("token_hash");
CREATE INDEX "student_payment_sessions_purchase_id_student_id_idx" ON "student_payment_sessions"("purchase_id", "student_id");
CREATE INDEX "student_payment_sessions_expires_at_idx" ON "student_payment_sessions"("expires_at");
ALTER TABLE "student_payment_sessions" ADD CONSTRAINT "student_payment_sessions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "student_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_payment_sessions" ADD CONSTRAINT "student_payment_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
