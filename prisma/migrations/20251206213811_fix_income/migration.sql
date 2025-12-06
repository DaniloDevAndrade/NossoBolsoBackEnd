/*
  Warnings:

  - You are about to drop the column `amount` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `creditCardId` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `installmentGroupId` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `partnerAmount` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `payer` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `splitType` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `userAmount` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `Income` table. All the data in the column will be lost.
  - You are about to drop the column `owner` on the `Income` table. All the data in the column will be lost.
  - Added the required column `value` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `Income` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `Income` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_creditCardId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_createdById_fkey";

-- DropIndex
DROP INDEX "Expense_accountId_idx";

-- DropIndex
DROP INDEX "Expense_category_idx";

-- DropIndex
DROP INDEX "Expense_createdById_idx";

-- DropIndex
DROP INDEX "Expense_creditCardId_idx";

-- DropIndex
DROP INDEX "Expense_date_idx";

-- DropIndex
DROP INDEX "Expense_installmentGroupId_idx";

-- DropIndex
DROP INDEX "Income_accountId_idx";

-- DropIndex
DROP INDEX "Income_category_idx";

-- DropIndex
DROP INDEX "Income_createdById_idx";

-- DropIndex
DROP INDEX "Income_date_idx";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "amount",
DROP COLUMN "creditCardId",
DROP COLUMN "installmentGroupId",
DROP COLUMN "partnerAmount",
DROP COLUMN "payer",
DROP COLUMN "splitType",
DROP COLUMN "userAmount",
ADD COLUMN     "cardId" TEXT,
ADD COLUMN     "installment" TEXT,
ADD COLUMN     "paidBy" TEXT,
ADD COLUMN     "partnerPays" DOUBLE PRECISION,
ADD COLUMN     "responsibleUserId" TEXT,
ADD COLUMN     "value" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "youPay" DOUBLE PRECISION,
ALTER COLUMN "date" DROP DEFAULT,
ALTER COLUMN "paymentMethod" DROP DEFAULT,
ALTER COLUMN "installments" DROP DEFAULT,
ALTER COLUMN "currentInstallment" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Income" DROP COLUMN "amount",
DROP COLUMN "owner",
ADD COLUMN     "partnerReceive" DOUBLE PRECISION,
ADD COLUMN     "receivedBy" TEXT,
ADD COLUMN     "responsibleUserId" TEXT,
ADD COLUMN     "value" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "youReceive" DOUBLE PRECISION,
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "date" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
