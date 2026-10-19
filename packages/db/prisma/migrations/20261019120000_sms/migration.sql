CREATE TYPE "SmsStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "Facility" ADD COLUMN "smsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Staff" ADD COLUMN "smsOptOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT,
    "toPhone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsMessage_facilityId_createdAt_idx" ON "SmsMessage"("facilityId", "createdAt");

ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
