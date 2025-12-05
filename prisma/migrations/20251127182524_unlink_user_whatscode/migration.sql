-- DropForeignKey
ALTER TABLE "WhatsappCode" DROP CONSTRAINT "WhatsappCode_userPhone_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';
