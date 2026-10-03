-- AlterTable
ALTER TABLE "users" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_deactivatedAt_idx" ON "users"("deactivatedAt");
