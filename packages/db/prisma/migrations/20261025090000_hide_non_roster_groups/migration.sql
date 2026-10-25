-- Accountants and administrators do not run rosters, so the Administrator and
-- Accountant cadres and the Administration department are no longer offered.
-- They are switched off (not deleted) in facilities that have them, and only
-- where nobody is recorded against them, so no staff record changes.
UPDATE "Cadre" c SET "active" = false
WHERE lower(c."name") IN ('administrator', 'accountant')
  AND NOT EXISTS (SELECT 1 FROM "Staff" s WHERE s."cadreId" = c."id");

UPDATE "Department" d SET "active" = false
WHERE lower(d."name") IN ('administration', 'accounts', 'accounts office')
  AND NOT EXISTS (SELECT 1 FROM "Staff" s WHERE s."departmentId" = d."id");
