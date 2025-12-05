/*
  Warnings:

  - Changed the type of `institution` on the `CreditCard` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CreditCardInstitution" AS ENUM ('NUBANK', 'INTER', 'ITAU', 'BANCO_DO_BRASIL', 'BRADESCO', 'SANTANDER', 'CAIXA', 'BTG_PACTUAL', 'C6_BANK', 'PAGBANK', 'OUTROS');

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "closingDay" INTEGER,
DROP COLUMN "institution",
ADD COLUMN     "institution" "CreditCardInstitution" NOT NULL;
