-- Which shift runs short first when there are not enough people.
ALTER TABLE "Shift" ADD COLUMN "keepFull" INTEGER NOT NULL DEFAULT 0;
