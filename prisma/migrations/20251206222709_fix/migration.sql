-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "installmentGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_accountId_idx" ON "Expense"("accountId");

-- CreateIndex
CREATE INDEX "Expense_createdById_idx" ON "Expense"("createdById");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_cardId_idx" ON "Expense"("cardId");

-- CreateIndex
CREATE INDEX "Expense_installmentGroupId_idx" ON "Expense"("installmentGroupId");
