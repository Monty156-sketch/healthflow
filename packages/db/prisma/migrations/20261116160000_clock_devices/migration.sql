-- Clock devices: a facility's own clocking machine feeds attendance.
ALTER TABLE "Staff" ADD COLUMN "clockNumber" TEXT;
CREATE UNIQUE INDEX "Staff_facilityId_clockNumber_key" ON "Staff"("facilityId", "clockNumber");

CREATE TABLE "ClockDevice" (
  "id" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "serialNumber" TEXT,
  "ipAddress" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastImportAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClockDevice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClockDevice_facilityId_idx" ON "ClockDevice"("facilityId");

CREATE TABLE "DevicePunch" (
  "id" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevicePunch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DevicePunch_deviceId_staffId_at_key" ON "DevicePunch"("deviceId", "staffId", "at");
CREATE INDEX "DevicePunch_facilityId_at_idx" ON "DevicePunch"("facilityId", "at");

ALTER TABLE "ClockDevice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "ClockDevice"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "DevicePunch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "DevicePunch"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));
