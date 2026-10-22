-- New monthly and setup prices, in Ghana cedis.
UPDATE "Plan" SET "monthlyPriceGhs" = 150 WHERE "id" = 'plan_chps' OR "name" = 'CHPS';
UPDATE "Plan" SET "monthlyPriceGhs" = 250 WHERE "id" = 'plan_hc' OR "name" = 'Health Centre';
UPDATE "Plan" SET "monthlyPriceGhs" = 1000, "setupPriceGhs" = 1500 WHERE "id" = 'plan_hospital' OR "name" = 'Hospital';
UPDATE "Plan" SET "monthlyPriceGhs" = 2000, "setupPriceGhs" = 2500 WHERE "id" = 'plan_teaching' OR "name" = 'Teaching and Regional Hospital';
