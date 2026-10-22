CREATE TABLE "WardInCharge" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "departmentId" TEXT,
    "claimedStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WardInCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WardInCharge_claimedStaffId_key" ON "WardInCharge"("claimedStaffId");
CREATE UNIQUE INDEX "WardInCharge_facilityId_nameKey_key" ON "WardInCharge"("facilityId", "nameKey");

ALTER TABLE "WardInCharge" ADD CONSTRAINT "WardInCharge_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WardInCharge" ADD CONSTRAINT "WardInCharge_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
