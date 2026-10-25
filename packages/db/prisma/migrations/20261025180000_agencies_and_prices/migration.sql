-- Two more agencies a facility or supervising office can belong to.
ALTER TYPE "HealthAgency" ADD VALUE IF NOT EXISTS 'AMMG';
ALTER TYPE "HealthAgency" ADD VALUE IF NOT EXISTS 'PRIVATE';

-- New monthly and setup prices, in Ghana cedis.
UPDATE "Plan" SET "monthlyPriceGhs" = 80, "setupPriceGhs" = 0 WHERE "id" = 'plan_chps' OR "name" IN ('CHPS', 'CHPS and Clinic');
UPDATE "Plan" SET "monthlyPriceGhs" = 120, "setupPriceGhs" = 0, "name" = 'Health Centre and Polyclinic' WHERE "id" = 'plan_hc' OR "name" = 'Health Centre';
UPDATE "Plan" SET "monthlyPriceGhs" = 400, "setupPriceGhs" = 500 WHERE "id" = 'plan_hospital' OR "name" = 'Hospital';
UPDATE "Plan" SET "monthlyPriceGhs" = 800, "setupPriceGhs" = 1200 WHERE "id" = 'plan_teaching' OR "name" = 'Teaching and Regional Hospital';
