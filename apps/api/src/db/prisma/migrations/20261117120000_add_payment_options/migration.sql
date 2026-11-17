-- How a member chose to pay at checkout.
CREATE TYPE "PaymentOption" AS ENUM ('PAYSTACK', 'BANK_TRANSFER', 'PAY_AT_RECEPTION');

-- Reception payments can be cash as well as POS.
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

ALTER TABLE "bookings" ADD COLUMN     "paymentOption" "PaymentOption";

-- Manual payments: the staff member who confirmed or recorded the payment, and
-- the bank transfer reference or POS receipt number they entered.
ALTER TABLE "transactions" ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "externalReference" TEXT;

-- Single-row configuration for the payment options offered at checkout.
CREATE TABLE "payment_settings" (
    "id" VARCHAR(64) NOT NULL DEFAULT 'default',
    "paystackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payAtReceptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "transferWindowHours" INTEGER NOT NULL DEFAULT 24,
    "receptionGraceMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" VARCHAR(64),

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- Mirror the API's validation so bad values cannot be stored by any path.
-- Keep in sync with apps/api/src/modules/payments/payment-options.ts.
ALTER TABLE "payment_settings" ADD CONSTRAINT "chk_payment_settings_transfer_window"
  CHECK ("transferWindowHours" BETWEEN 1 AND 168);
ALTER TABLE "payment_settings" ADD CONSTRAINT "chk_payment_settings_reception_grace"
  CHECK ("receptionGraceMinutes" BETWEEN 0 AND 240);
ALTER TABLE "payment_settings" ADD CONSTRAINT "chk_payment_settings_account_number"
  CHECK ("bankAccountNumber" IS NULL OR "bankAccountNumber" ~ '^[0-9]{10}$');

-- One bank credit or POS receipt can settle only one payment: stops a single
-- statement line (or an invented reference) confirming several bookings.
CREATE UNIQUE INDEX "uq_transactions_manual_external_reference"
  ON "transactions" ("method", "externalReference")
  WHERE "externalReference" IS NOT NULL AND "method" IN ('BANK_TRANSFER', 'POS_TERMINAL');

-- A manual refund payout reference can be recorded only once. Gateway refunds
-- always set "paystackRefundId", so existing rows are not affected.
CREATE UNIQUE INDEX "uq_refund_requests_manual_payout_reference"
  ON "refund_requests" ("gatewayReference")
  WHERE "gatewayReference" IS NOT NULL AND "paystackRefundId" IS NULL;
