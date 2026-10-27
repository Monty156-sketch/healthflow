-- Emergency deployments: people taken off the usual roster for a stretch and given one shift.
CREATE TYPE "DeploymentStatus" AS ENUM ('ACTIVE', 'CLOSED');

CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeploymentMember" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "returnedOn" DATE,
    "returnedBy" TEXT,
    CONSTRAINT "DeploymentMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Deployment_facilityId_status_idx" ON "Deployment"("facilityId", "status");
CREATE UNIQUE INDEX "DeploymentMember_deploymentId_staffId_key" ON "DeploymentMember"("deploymentId", "staffId");
CREATE INDEX "DeploymentMember_staffId_idx" ON "DeploymentMember"("staffId");

ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeploymentMember" ADD CONSTRAINT "DeploymentMember_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeploymentMember" ADD CONSTRAINT "DeploymentMember_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeploymentMember" ADD CONSTRAINT "DeploymentMember_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
