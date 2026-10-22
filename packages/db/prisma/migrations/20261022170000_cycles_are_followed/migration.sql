-- A duty cycle is a rule the roster follows, not a preference it may drop. Existing rules
-- were created as "prefer"; set them to follow so the roster is built from them first.
UPDATE "DutyCycleRule" SET "enforcement" = 'BLOCK' WHERE "enforcement" = 'PREFER';
