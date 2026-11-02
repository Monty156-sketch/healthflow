-- An announcement is now cleared by the person who clears it, not for the whole facility.
-- Rows made before this keep an empty userId and still hide that announcement for the facility.
ALTER TABLE "AnnouncementSeen" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AnnouncementSeen" DROP CONSTRAINT "AnnouncementSeen_pkey";
ALTER TABLE "AnnouncementSeen" ADD CONSTRAINT "AnnouncementSeen_pkey" PRIMARY KEY ("announcementId", "facilityId", "userId");
