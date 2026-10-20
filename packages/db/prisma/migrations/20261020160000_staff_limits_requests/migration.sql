-- Cadres on office hours, people who can lead a shift, personal monthly limits,
-- periods without nights, and day-off requests.
ALTER TABLE "Cadre" ADD COLUMN "weekdaysOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Staff" ADD COLUMN "canLead" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "maxNightsPerMonth" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "maxHoursPerMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN "minLeads" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "StaffRestrictionKind" AS ENUM ('NO_NIGHTS');
CREATE TABLE "StaffRestriction" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" "StaffRestrictionKind" NOT NULL DEFAULT 'NO_NIGHTS',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffRestriction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffRestriction_facilityId_staffId_idx" ON "StaffRestriction"("facilityId", "staffId");
ALTER TABLE "StaffRestriction" ADD CONSTRAINT "StaffRestriction_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffRestriction" ADD CONSTRAINT "StaffRestriction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "DayOffStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'WITHDRAWN');
CREATE TABLE "DayOffRequest" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "status" "DayOffStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DayOffRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DayOffRequest_staffId_date_key" ON "DayOffRequest"("staffId", "date");
CREATE INDEX "DayOffRequest_facilityId_date_idx" ON "DayOffRequest"("facilityId", "date");
ALTER TABLE "DayOffRequest" ADD CONSTRAINT "DayOffRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayOffRequest" ADD CONSTRAINT "DayOffRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
