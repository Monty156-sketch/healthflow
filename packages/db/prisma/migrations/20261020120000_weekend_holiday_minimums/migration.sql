-- Weekend and public-holiday minimums, per shift and per ward. Null keeps the weekday numbers.
ALTER TABLE "Shift" ADD COLUMN "weekendMinStaff" INTEGER, ADD COLUMN "weekendMinByCadre" JSONB, ADD COLUMN "holidayMinStaff" INTEGER, ADD COLUMN "holidayMinByCadre" JSONB;
ALTER TABLE "ShiftDemand" ADD COLUMN "weekendMinStaff" INTEGER, ADD COLUMN "weekendMinByCadre" JSONB, ADD COLUMN "holidayMinStaff" INTEGER, ADD COLUMN "holidayMinByCadre" JSONB;
