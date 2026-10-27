-- The district a facility chose at registration, so a district office approved later can claim the facilities that chose it.
ALTER TABLE "Facility" ADD COLUMN "districtName" TEXT;
