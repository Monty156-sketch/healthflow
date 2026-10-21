-- The night and office-hour settings for the standard departments and cadres are fixed, as Ghana Health Service facilities run them.

-- Departments that do not run nights; every other standard department does.
UPDATE "Department" SET "runsNights" = false
WHERE lower("name") IN ('accounts','administration','antenatal and postnatal','child welfare','dental','eye','physiotherapy','public health','radiology','stores');
UPDATE "Department" SET "runsNights" = true
WHERE lower("name") IN ('outpatient','maternity','emergency','surgery','medicine','paediatrics','theatre','intensive care','laboratory','pharmacy','records','transport','mortuary','support services','clinical nurses','midwives','security','drivers');

-- Weekday mornings only (Monday to Friday).
UPDATE "Cadre" SET "onRoster" = true, "weekdaysOnly" = true, "takesNights" = false
WHERE lower("name") IN ('specialist','community health nurse','radiographer','physiotherapist','dietician','dental surgeon','dental therapist','disease control officer','health information officer');

-- Accountants and administrators: weekday office hours, not on the duty roster.
UPDATE "Cadre" SET "onRoster" = false, "weekdaysOnly" = true, "takesNights" = false
WHERE lower("name") IN ('accountant','administrator');

-- Shifts with nights.
UPDATE "Cadre" SET "onRoster" = true, "weekdaysOnly" = false, "takesNights" = true
WHERE lower("name") IN ('midwife','nurse','enrolled nurse','community health officer','nurse anaesthetist','health assistant','ward assistant','orderly','driver','security');

-- Shifts, days only.
UPDATE "Cadre" SET "onRoster" = true, "weekdaysOnly" = false, "takesNights" = false
WHERE lower("name") IN ('physician assistant','pharmacist','pharmacy technician','laboratory scientist','laboratory technician','cleaner');

UPDATE "Cadre" SET "onRoster" = false, "weekdaysOnly" = false, "takesNights" = false WHERE lower("name") = 'medical officer';

-- A health centre, clinic or CHPS compound rosters by unit: clinical nurses, midwives, public health.
INSERT INTO "Department" ("id","facilityId","name","active","runsNights","kind")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || f."id" || u.n), 1, 24), f."id", u.n, true, u.nights, 'WARD'
FROM "Facility" f
CROSS JOIN (VALUES ('Clinical Nurses', true), ('Midwives', true), ('Public Health', false)) AS u(n, nights)
WHERE f."facilityType" IN ('CHPS_COMPOUND','HEALTH_CENTRE','CLINIC')
  AND NOT EXISTS (SELECT 1 FROM "Department" d WHERE d."facilityId" = f."id" AND lower(d."name") = lower(u.n));

-- Staff move into their unit by cadre.
UPDATE "Staff" s SET "departmentId" = d."id"
FROM "Cadre" c, "Facility" f, "Department" d
WHERE s."cadreId" = c."id" AND f."id" = s."facilityId" AND f."facilityType" IN ('CHPS_COMPOUND','HEALTH_CENTRE','CLINIC')
  AND d."facilityId" = s."facilityId" AND s."status" IN ('ACTIVE','PENDING','ON_LEAVE')
  AND lower(d."name") = CASE
    WHEN lower(c."name") LIKE '%midwi%' THEN 'midwives'
    WHEN lower(c."name") IN ('nurse','enrolled nurse') THEN 'clinical nurses'
    WHEN lower(c."name") IN ('community health nurse','community health officer','disease control officer') THEN 'public health'
  END;
