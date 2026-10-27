-- Partial leave comes out of the annual days, so it has no entitlement of its own.
UPDATE "LeaveType" SET "countsAgainstEntitlement" = false WHERE "code" = 'PART';
-- Every member of staff starts out willing to cover extra duties (swaps, sickness). Anyone can still turn it off.
ALTER TABLE "Staff" ALTER COLUMN "willingForExtraDuties" SET DEFAULT true;
UPDATE "Staff" SET "willingForExtraDuties" = true WHERE "willingForExtraDuties" = false;
