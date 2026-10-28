-- WhatsApp duty reminders: the facility switch, each person's own opt-in, and the record of what was sent.
ALTER TABLE "Facility" ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Staff" ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Staff" ADD COLUMN "whatsappOptInAt" TIMESTAMP(3);

CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "dutyDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappMessage_staffId_dutyDate_kind_key" ON "WhatsappMessage"("staffId", "dutyDate", "kind");
CREATE INDEX "WhatsappMessage_facilityId_createdAt_idx" ON "WhatsappMessage"("facilityId", "createdAt");

ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
