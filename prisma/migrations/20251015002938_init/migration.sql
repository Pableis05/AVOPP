-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "Activity" ADD COLUMN "completedBy" TEXT;

-- CreateIndex
CREATE INDEX "Activity_completedAt_idx" ON "Activity"("completedAt");
