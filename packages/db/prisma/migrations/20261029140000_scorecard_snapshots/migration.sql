-- Frozen scorecard figures for finished months.
CREATE TABLE "ScorecardSnapshot" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScorecardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScorecardSnapshot_facilityId_year_month_key" ON "ScorecardSnapshot"("facilityId", "year", "month");

ALTER TABLE "ScorecardSnapshot" ADD CONSTRAINT "ScorecardSnapshot_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
