-- Leave categories: the old "junior" grade carried 28 days, which is category D (intermediate). Category E (junior) now carries 21.
UPDATE "Staff" SET "leaveGrade" = 'INTERMEDIATE' WHERE "leaveGrade" = 'JUNIOR';

-- A short absence a person asks for themselves is a one-person deployment with no shift.
ALTER TABLE "Deployment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'EXERCISE';
ALTER TABLE "DeploymentMember" ALTER COLUMN "shiftId" DROP NOT NULL;
