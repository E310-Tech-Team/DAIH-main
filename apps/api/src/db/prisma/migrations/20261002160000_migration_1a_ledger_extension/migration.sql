-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'ABANDONED';

-- DropIndex
DROP INDEX "refund_requests_bookingId_key";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cashDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "coinTenderAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "coinsRedeemed" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "conversionRateSnapshot" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "refund_requests" ADD COLUMN     "isSystemInitiated" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "bookingId" DROP NOT NULL,
ALTER COLUMN "requestedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "leaseHolder" TEXT,
    "leasedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "webhook_events_status_leaseExpiresAt_idx" ON "webhook_events"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "webhook_events_eventId_idx" ON "webhook_events"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_transactionId_key" ON "refund_requests"("transactionId");

-- CreateIndex
CREATE INDEX "refund_requests_transactionId_idx" ON "refund_requests"("transactionId");

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill cashDue for existing bookings
UPDATE "bookings" SET "cashDue" = "totalAmount" WHERE "cashDue" = 0;

-- Partial Index for active held bookings
CREATE INDEX IF NOT EXISTS idx_bookings_active_held ON bookings("resourceId", "startTime", "endTime") WHERE state IN ('HELD', 'PENDING_PAYMENT');
