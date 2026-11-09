-- Attendance from the clock and the facility's book. Additive only: three nullable columns and one new table.
ALTER TABLE "Attendance" ADD COLUMN "clockedAt" TIMESTAMP(3), ADD COLUMN "minutesEarly" INTEGER, ADD COLUMN "source" TEXT;

CREATE TABLE "AttendanceMonthApproval" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AttendanceMonthApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceMonthApproval_facilityId_year_month_key" ON "AttendanceMonthApproval"("facilityId", "year", "month");
CREATE INDEX "AttendanceMonthApproval_facilityId_idx" ON "AttendanceMonthApproval"("facilityId");

ALTER TABLE "AttendanceMonthApproval" ADD CONSTRAINT "AttendanceMonthApproval_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceMonthApproval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "AttendanceMonthApproval"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));
