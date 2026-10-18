-- Every facility gets the standard cadres and departments it does not already
-- have, matched by name regardless of case. Nothing existing is changed.
INSERT INTO "Cadre" ("id","facilityId","name","sortOrder","active")
SELECT gen_random_uuid()::text, f."id", c.name, c.ord, true
FROM "Facility" f
CROSS JOIN (VALUES ('Medical Officer', 0), ('Specialist', 1), ('Physician Assistant', 2), ('Midwife', 3), ('Nurse', 4), ('Enrolled Nurse', 5), ('Community Health Nurse', 6), ('Community Health Officer', 7), ('Nurse Anaesthetist', 8), ('Pharmacist', 9), ('Pharmacy Technician', 10), ('Laboratory Scientist', 11), ('Laboratory Technician', 12), ('Radiographer', 13), ('Physiotherapist', 14), ('Dietician', 15), ('Dental Surgeon', 16), ('Dental Therapist', 17), ('Disease Control Officer', 18), ('Health Information Officer', 19), ('Health Assistant', 20), ('Ward Assistant', 21), ('Orderly', 22), ('Accountant', 23), ('Administrator', 24), ('Driver', 25), ('Security', 26)) AS c(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM "Cadre" x WHERE x."facilityId" = f."id" AND lower(x."name") = lower(c.name));

INSERT INTO "Department" ("id","facilityId","name","active")
SELECT gen_random_uuid()::text, f."id", d.name, true
FROM "Facility" f
CROSS JOIN (VALUES ('Outpatient'), ('Maternity'), ('Antenatal and Postnatal'), ('Child Welfare'), ('Emergency'), ('Surgery'), ('Medicine'), ('Paediatrics'), ('Theatre'), ('Intensive Care'), ('Laboratory'), ('Pharmacy'), ('Radiology'), ('Dental'), ('Eye'), ('Physiotherapy'), ('Public Health'), ('Records'), ('Administration'), ('Accounts'), ('Stores'), ('Transport'), ('Mortuary'), ('Support Services')) AS d(name)
WHERE NOT EXISTS (SELECT 1 FROM "Department" x WHERE x."facilityId" = f."id" AND lower(x."name") = lower(d.name));
