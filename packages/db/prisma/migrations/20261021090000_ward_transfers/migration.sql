ALTER TYPE "FacilityType" ADD VALUE 'REGIONAL_HOSPITAL';
ALTER TYPE "FacilityType" ADD VALUE 'TEACHING_HOSPITAL';

ALTER TABLE "Staff" ADD COLUMN "requestedInCharge" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "TransferKind" AS ENUM ('ROUTINE', 'EMERGENCY');

CREATE TABLE "WardTransfer" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "kind" "TransferKind" NOT NULL DEFAULT 'ROUTINE',
    "inCharge" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "WardTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WardTransfer_facilityId_effectiveDate_idx" ON "WardTransfer"("facilityId", "effectiveDate");
CREATE INDEX "WardTransfer_staffId_idx" ON "WardTransfer"("staffId");

ALTER TABLE "WardTransfer" ADD CONSTRAINT "WardTransfer_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WardTransfer" ADD CONSTRAINT "WardTransfer_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WardTransfer" ADD CONSTRAINT "WardTransfer_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WardTransfer" ADD CONSTRAINT "WardTransfer_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
