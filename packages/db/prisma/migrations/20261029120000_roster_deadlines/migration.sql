-- A facility's roster publishing deadline, the record of rosters published late, and the reminders already sent.
ALTER TABLE "Facility" ADD COLUMN "rosterDeadlineDay" INTEGER;
ALTER TABLE "Roster" ADD COLUMN "publishedLate" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "RosterDeadlineReminder" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterDeadlineReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RosterDeadlineReminder_facilityId_unitKey_year_month_stage_key" ON "RosterDeadlineReminder"("facilityId", "unitKey", "year", "month", "stage");

ALTER TABLE "RosterDeadlineReminder" ADD CONSTRAINT "RosterDeadlineReminder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
