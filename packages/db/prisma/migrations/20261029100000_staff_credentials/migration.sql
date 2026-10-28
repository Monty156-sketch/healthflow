-- Licences and certificates held by staff, with expiry dates, and which a cadre must hold.
ALTER TABLE "Cadre" ADD COLUMN "requiredCredentials" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "StaffCredential" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "noExpiry" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "remindedStage" INTEGER NOT NULL DEFAULT 0,
    "addedBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffCredential_facilityId_expiresOn_idx" ON "StaffCredential"("facilityId", "expiresOn");
CREATE INDEX "StaffCredential_staffId_idx" ON "StaffCredential"("staffId");

ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
