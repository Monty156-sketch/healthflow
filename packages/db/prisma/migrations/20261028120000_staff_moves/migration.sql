-- A member of staff posted to another facility that is also on HealthFlow.
CREATE TYPE "StaffMoveStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "StaffMove" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fromFacilityId" TEXT NOT NULL,
    "toFacilityId" TEXT NOT NULL,
    "status" "StaffMoveStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "StaffMove_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffMove_fromFacilityId_status_idx" ON "StaffMove"("fromFacilityId", "status");
CREATE INDEX "StaffMove_toFacilityId_status_idx" ON "StaffMove"("toFacilityId", "status");
CREATE INDEX "StaffMove_staffId_idx" ON "StaffMove"("staffId");

ALTER TABLE "StaffMove" ADD CONSTRAINT "StaffMove_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffMove" ADD CONSTRAINT "StaffMove_fromFacilityId_fkey" FOREIGN KEY ("fromFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffMove" ADD CONSTRAINT "StaffMove_toFacilityId_fkey" FOREIGN KEY ("toFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
