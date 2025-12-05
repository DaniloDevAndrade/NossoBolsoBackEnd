/*
  Warnings:

  - A unique constraint covering the columns `[userPhone]` on the table `WhatsappCode` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappCode_userPhone_key" ON "WhatsappCode"("userPhone");
