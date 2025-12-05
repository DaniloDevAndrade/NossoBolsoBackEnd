/*
  Warnings:

  - A unique constraint covering the columns `[challengeId]` on the table `WhatsappCode` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "WhatsappCode" ADD COLUMN     "challengeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappCode_challengeId_key" ON "WhatsappCode"("challengeId");
