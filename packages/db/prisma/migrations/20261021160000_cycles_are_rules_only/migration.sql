-- A duty cycle is only "N duties, then M days off". Which shift follows comes from the rotation.
UPDATE "DutyCycleRule" SET "nextShiftAfterRestId" = NULL, "blockShiftPatternIds" = '{}';
