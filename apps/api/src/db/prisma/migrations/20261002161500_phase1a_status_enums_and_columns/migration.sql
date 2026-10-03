-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'FLAGGED_MISMATCH';
ALTER TYPE "PaymentStatus" ADD VALUE 'REQUIRES_RECONCILIATION';

-- AlterEnum
ALTER TYPE "RefundReasonCode" ADD VALUE 'PRICE_CHANGED';

-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "RefundStatus" ADD VALUE 'REQUIRES_RECONCILIATION';

-- AlterEnum
ALTER TYPE "WebhookEventStatus" ADD VALUE 'DEAD_LETTER';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "refund_requests" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "claimedAt" TIMESTAMP(3),
ADD COLUMN "gatewayRequestedAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "workerId" TEXT;

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "workerId" TEXT;

-- CreateIndex
CREATE INDEX "webhook_events_status_nextAttemptAt_idx" ON "webhook_events"("status", "nextAttemptAt");
