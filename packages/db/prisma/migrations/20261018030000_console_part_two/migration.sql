-- AlterTable
ALTER TABLE "LegalDocument" ADD COLUMN "material" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ErrorReport" ADD COLUMN "resolutionNote" TEXT,
ADD COLUMN "reply" TEXT,
ADD COLUMN "repliedAt" TIMESTAMP(3),
ADD COLUMN "repliedBy" TEXT;

-- CreateTable
CREATE TABLE "AnnouncementSeen" (
    "announcementId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementSeen_pkey" PRIMARY KEY ("announcementId","facilityId")
);
