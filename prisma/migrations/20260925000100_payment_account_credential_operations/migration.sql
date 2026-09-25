CREATE TABLE "payment_account_credential_operations" (
  "id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "environment" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_account_credential_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_account_credential_operations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_account_credential_operations_teacher_id_environment_operation_operation_key_key" ON "payment_account_credential_operations"("teacher_id", "environment", "operation", "operation_key");
