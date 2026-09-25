ALTER TABLE "payment_accounts"
ADD COLUMN "provider_webhook_id" TEXT;

CREATE UNIQUE INDEX "payment_accounts_provider_webhook_id_key"
ON "payment_accounts"("provider_webhook_id");
