-- The four plans, in Ghana cedis. Added only if a plan of that name does not
-- already exist, so a plan edited in the console is never overwritten.
INSERT INTO "Plan" ("id","name","monthlyPriceGhs","setupPriceGhs","staffBandMin","staffBandMax","active","sortOrder")
SELECT v.id, v.name, v.monthly, v.setup, v.bmin, v.bmax, true, v.ord
FROM (VALUES
  ('plan_chps',     'CHPS',                       250::float8,  0::float8,    1,   25,   1),
  ('plan_hc',       'Health Centre',              550::float8,  0::float8,    26,  80,   2),
  ('plan_hospital', 'Hospital',                   1200::float8, 2000::float8, 81,  300,  3),
  ('plan_teaching', 'Teaching and Regional Hospital', 2500::float8, 3500::float8, 500, 2000, 4)
) AS v(id,name,monthly,setup,bmin,bmax,ord)
WHERE NOT EXISTS (SELECT 1 FROM "Plan" p WHERE p."name" = v.name);
