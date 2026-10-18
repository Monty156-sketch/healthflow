-- Ward rosters: a roster can belong to one department, a roster manager can be limited to one department,
-- and a ward can ask for its own minimum staff on a shift.
ALTER TABLE "Roster" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Roster" ADD CONSTRAINT "Roster_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX "Roster_facilityId_month_year_key";
CREATE UNIQUE INDEX "Roster_facilityId_month_year_departmentId_key" ON "Roster"("facilityId", "month", "year", "departmentId");
-- At most one whole-facility roster per month.
CREATE UNIQUE INDEX "Roster_whole_facility_month_key" ON "Roster"("facilityId", "month", "year") WHERE "departmentId" IS NULL;

ALTER TABLE "UserProfile" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ShiftDemand" (
  "id" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "minStaff" INTEGER NOT NULL DEFAULT 0,
  "minByCadre" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "ShiftDemand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftDemand_departmentId_shiftId_key" ON "ShiftDemand"("departmentId", "shiftId");
CREATE INDEX "ShiftDemand_facilityId_idx" ON "ShiftDemand"("facilityId");
ALTER TABLE "ShiftDemand" ADD CONSTRAINT "ShiftDemand_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
