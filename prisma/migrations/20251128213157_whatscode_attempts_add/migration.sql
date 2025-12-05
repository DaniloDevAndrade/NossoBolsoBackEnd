-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialEndsAt" SET DEFAULT NOW() + INTERVAL '30 days';

-- AlterTable
ALTER TABLE "WhatsappCode" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
