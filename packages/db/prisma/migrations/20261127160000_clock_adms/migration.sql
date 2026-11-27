-- The machine's own feed (no PC in between): when it last contacted us, a way to find a machine by its serial number,
-- and the Check In / Check Out word kept with each punch so a lone check-out can find its check-in.
ALTER TABLE "ClockDevice" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
CREATE INDEX "ClockDevice_serialNumber_idx" ON "ClockDevice"("serialNumber");
ALTER TABLE "DevicePunch" ADD COLUMN "state" TEXT;
