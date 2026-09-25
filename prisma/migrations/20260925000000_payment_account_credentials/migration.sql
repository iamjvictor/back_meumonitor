-- CreateTable
CREATE TABLE "payment_account_credentials" (
    "id" UUID NOT NULL,
    "payment_account_id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_account_credentials_payment_account_id_key" ON "payment_account_credentials"("payment_account_id");

-- AddForeignKey
ALTER TABLE "payment_account_credentials" ADD CONSTRAINT "payment_account_credentials_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure key versions are always positive.
ALTER TABLE "payment_account_credentials" ADD CONSTRAINT "payment_account_credentials_key_version_check" CHECK ("key_version" > 0);
