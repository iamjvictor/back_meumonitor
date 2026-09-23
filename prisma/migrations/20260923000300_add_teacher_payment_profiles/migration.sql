CREATE TABLE "teacher_payment_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL,
  "payment_account_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "cpf_cnpj" TEXT NOT NULL,
  "birth_date" TEXT,
  "company_type" TEXT,
  "mobile_phone" TEXT NOT NULL,
  "income_value" DECIMAL(14,2) NOT NULL,
  "address" TEXT NOT NULL,
  "address_number" TEXT NOT NULL,
  "complement" TEXT,
  "province" TEXT NOT NULL,
  "postal_code" TEXT NOT NULL,
  "site" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_payment_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teacher_payment_profiles_payment_account_id_key"
  ON "teacher_payment_profiles"("payment_account_id");
CREATE INDEX "teacher_payment_profiles_teacher_id_created_at_idx"
  ON "teacher_payment_profiles"("teacher_id", "created_at");

ALTER TABLE "teacher_payment_profiles"
  ADD CONSTRAINT "teacher_payment_profiles_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teacher_payment_profiles"
  ADD CONSTRAINT "teacher_payment_profiles_payment_account_id_fkey"
  FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teacher_payment_profiles" ENABLE ROW LEVEL SECURITY;
