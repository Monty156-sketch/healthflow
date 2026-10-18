-- A rotation is an ordered list of shifts; the implicit many-to-many keeps no order, so the order is stored here.
ALTER TABLE "ShiftRotation" ADD COLUMN "sequenceOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
