-- Nursing manager and medical superintendent, and the roster approval chain.
-- Additive only: two new roles, two new roster steps, one facility switch (off by default) and two note columns.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'NURSING_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MEDICAL_SUPERINTENDENT';
ALTER TYPE "RosterStatus" ADD VALUE IF NOT EXISTS 'WITH_ADMINISTRATOR';
ALTER TYPE "RosterStatus" ADD VALUE IF NOT EXISTS 'WITH_SUPERINTENDENT';

ALTER TABLE "Facility" ADD COLUMN "rosterApprovalChain" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Roster" ADD COLUMN "returnNote" TEXT, ADD COLUMN "returnedBy" TEXT;
