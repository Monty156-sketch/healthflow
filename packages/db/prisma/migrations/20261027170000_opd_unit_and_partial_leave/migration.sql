-- The health centre unit for nurses is now called OPD. A facility that already
-- has an OPD department keeps both, so nothing is merged and no staff record changes.
UPDATE "Department" d SET "name" = 'OPD'
WHERE d."name" = 'Clinical Nurses'
  AND NOT EXISTS (SELECT 1 FROM "Department" o WHERE o."facilityId" = d."facilityId" AND lower(o."name") = 'opd');

-- Partial leave: a leave type with its own yearly days, added to every facility that already has its leave types.
-- New facilities get it with the others. Entitlements for it start unset.
INSERT INTO "LeaveType" ("id", "facilityId", "name", "code", "colour", "isPaid", "countsAgainstEntitlement", "sortOrder", "isShortAbsence", "createsDutyDebt", "returnDateSetBy")
SELECT gen_random_uuid()::text, f."id", 'Partial leave', 'PART', '#4f7a5a', true, true,
       COALESCE((SELECT max(t."sortOrder") FROM "LeaveType" t WHERE t."facilityId" = f."id"), 0) + 1,
       false, false, 'IN_CHARGE'::"ReturnDateSetBy"
FROM "Facility" f
WHERE EXISTS (SELECT 1 FROM "LeaveType" t WHERE t."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "LeaveType" t WHERE t."facilityId" = f."id" AND t."code" = 'PART');
