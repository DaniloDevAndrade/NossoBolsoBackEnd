-- DropIndex
DROP INDEX "WhatsappCode_userPhone_type_used_idx";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';
