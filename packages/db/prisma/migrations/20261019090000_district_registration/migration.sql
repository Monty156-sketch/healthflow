CREATE TYPE "DistrictStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED');

ALTER TABLE "District"
  ADD COLUMN "status" "DistrictStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactRole" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "officeAddress" TEXT,
  ADD COLUMN "registeredAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "declineReason" TEXT;

ALTER TABLE "AccessRequest" ADD COLUMN "districtId" TEXT;
