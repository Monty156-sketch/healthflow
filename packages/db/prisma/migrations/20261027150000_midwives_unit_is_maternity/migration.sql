-- The health centre unit for midwives is now called Maternity. The Midwife
-- cadre is unchanged. A facility that already has a Maternity department keeps
-- both, so nothing is merged and no staff record changes.
UPDATE "Department" d SET "name" = 'Maternity'
WHERE d."name" = 'Midwives'
  AND NOT EXISTS (SELECT 1 FROM "Department" m WHERE m."facilityId" = d."facilityId" AND lower(m."name") = 'maternity');
