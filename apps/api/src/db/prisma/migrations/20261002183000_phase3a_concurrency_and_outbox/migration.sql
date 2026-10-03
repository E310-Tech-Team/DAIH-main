-- AlterEnum
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "outbox_events_status_lockedAt_idx" ON "outbox_events"("status", "lockedAt");

-- Pre-flight assertion against duplicate open visit sessions
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "bookingId"
    FROM "visit_sessions"
    WHERE "checkOutTime" IS NULL
    GROUP BY "bookingId"
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Migration 3A aborted: Found % booking(s) with duplicate open visit sessions. Manual resolution required before creating partial unique index.', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_visit_session 
ON "visit_sessions" ("bookingId") 
WHERE "checkOutTime" IS NULL;

ALTER TABLE "coin_balances" DROP CONSTRAINT IF EXISTS "chk_coin_balance_non_negative";
ALTER TABLE "coin_balances" DROP CONSTRAINT IF EXISTS "chk_coin_lifetime_earned_non_negative";
ALTER TABLE "coin_balances" DROP CONSTRAINT IF EXISTS "chk_coin_lifetime_burned_non_negative";

ALTER TABLE "coin_balances" ADD CONSTRAINT "chk_coin_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "coin_balances" ADD CONSTRAINT "chk_coin_lifetime_earned_non_negative" CHECK ("lifetimeEarned" >= 0);
ALTER TABLE "coin_balances" ADD CONSTRAINT "chk_coin_lifetime_burned_non_negative" CHECK ("lifetimeBurned" >= 0);
