-- CLAIMED reserva o evento enquanto os efeitos do webhook são aplicados.
ALTER TABLE "billing_webhook_events"
  DROP CONSTRAINT IF EXISTS "billing_webhook_events_status_check";

ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_status_check"
  CHECK ("status" IN ('RECEIVED', 'CLAIMED', 'PROCESSED', 'FAILED')) NOT VALID;
