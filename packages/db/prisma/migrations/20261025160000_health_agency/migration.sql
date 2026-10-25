-- Ghana Health Service or CHAG, for facilities and for districts. Everything
-- that exists today is Ghana Health Service.
CREATE TYPE "HealthAgency" AS ENUM ('GHS', 'CHAG');
ALTER TABLE "Facility" ADD COLUMN "agency" "HealthAgency" NOT NULL DEFAULT 'GHS';
ALTER TABLE "District" ADD COLUMN "agency" "HealthAgency" NOT NULL DEFAULT 'GHS';
