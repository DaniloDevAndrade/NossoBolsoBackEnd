/*
  Warnings:

  - You are about to drop the column `userId` on the `WhatsappCode` table. All the data in the column will be lost.
  - Added the required column `userPhone` to the `WhatsappCode` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "WhatsappCode" DROP CONSTRAINT "WhatsappCode_userId_fkey";

-- DropIndex
DROP INDEX "WhatsappCode_userId_type_used_idx";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "WhatsappCode" DROP COLUMN "userId",
ADD COLUMN     "userPhone" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "WhatsappCode_userPhone_type_used_idx" ON "WhatsappCode"("userPhone", "type", "used");

-- AddForeignKey
ALTER TABLE "WhatsappCode" ADD CONSTRAINT "WhatsappCode_userPhone_fkey" FOREIGN KEY ("userPhone") REFERENCES "User"("phone") ON DELETE RESTRICT ON UPDATE CASCADE;
