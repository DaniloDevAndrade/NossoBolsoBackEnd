-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "installmentGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_installmentGroupId_idx" ON "Expense"("installmentGroupId");
