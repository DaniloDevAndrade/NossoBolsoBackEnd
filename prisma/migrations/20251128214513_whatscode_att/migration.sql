/*
  Warnings:

  - You are about to drop the column `userPhone` on the `WhatsappCode` table. All the data in the column will be lost.
  - Added the required column `userId` to the `WhatsappCode` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "WhatsappCode_userPhone_key";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "WhatsappCode" DROP COLUMN "userPhone",
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "WhatsappCode_userId_type_used_idx" ON "WhatsappCode"("userId", "type", "used");

-- AddForeignKey
ALTER TABLE "WhatsappCode" ADD CONSTRAINT "WhatsappCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
