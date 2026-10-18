-- Who works nights and who is on the duty roster.
ALTER TABLE "Cadre" ADD COLUMN "takesNights" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Cadre" ADD COLUMN "onRoster" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Department" ADD COLUMN "runsNights" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Staff" ADD COLUMN "morningOnly" BOOLEAN NOT NULL DEFAULT false;

-- Nights go to nurses and midwives (and health assistants); other cadres can be switched on by the facility.
UPDATE "Cadre" SET "takesNights" = false
WHERE "name" !~* '(nurs|midwi|community health|health assist)';
-- Doctors are not on the duty roster.
UPDATE "Cadre" SET "onRoster" = false, "takesNights" = false
WHERE "name" ~* '(medical officer|specialist|doctor|physician|surgeon|consultant)' AND "name" !~* 'assistant';
-- Departments that do not run at night.
UPDATE "Department" SET "runsNights" = false
WHERE "name" ~* '(^eye|ophthal|optom|dental|physio|dermat|^ent$|ear,? nose|outpatient|^opd|records|administration|accounts|stores|transport|public health|child welfare)';
-- In-charges work weekday mornings only.
UPDATE "Staff" SET "morningOnly" = true WHERE "position" ~* 'in[- ]?charge';
