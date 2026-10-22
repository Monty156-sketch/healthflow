-- CHPS compounds and clinics are on the same plan.
UPDATE "Plan" SET "name" = 'CHPS and Clinic' WHERE "id" = 'plan_chps' AND "name" = 'CHPS';
