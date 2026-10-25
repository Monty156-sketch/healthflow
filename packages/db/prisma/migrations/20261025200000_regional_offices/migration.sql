-- A regional office is a supervising office above districts. Districts that
-- register under it wait for the region to approve them.
CREATE TYPE "SupervisorLevel" AS ENUM ('DISTRICT', 'REGION');
ALTER TABLE "District" ADD COLUMN "level" "SupervisorLevel" NOT NULL DEFAULT 'DISTRICT';
ALTER TABLE "District" ADD COLUMN "regionOfficeId" TEXT;
ALTER TABLE "District" ADD CONSTRAINT "District_regionOfficeId_fkey" FOREIGN KEY ("regionOfficeId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "District_regionOfficeId_idx" ON "District"("regionOfficeId");
