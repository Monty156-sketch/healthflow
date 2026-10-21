ALTER TABLE "Facility" ADD COLUMN "geoLat" DOUBLE PRECISION, ADD COLUMN "geoLng" DOUBLE PRECISION, ADD COLUMN "geoRadiusM" INTEGER;

CREATE TABLE "ClockEvent" (
  "id" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "distanceM" INTEGER NOT NULL,
  CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClockEvent_facilityId_at_idx" ON "ClockEvent"("facilityId", "at");
CREATE INDEX "ClockEvent_staffId_at_idx" ON "ClockEvent"("staffId", "at");
