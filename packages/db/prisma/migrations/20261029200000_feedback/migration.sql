-- User feedback: a rating and an optional comment, asked for now and then and always available.
-- Additive and forward-only. Nothing existing is changed except one nullable column.

CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'READ', 'ACTIONED');

ALTER TABLE "UserProfile" ADD COLUMN "feedbackNextAt" TIMESTAMP(3);

CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "rating" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT,
    "screen" TEXT,
    "asked" BOOLEAN NOT NULL DEFAULT false,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE INDEX "Feedback_facilityId_idx" ON "Feedback"("facilityId");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "Feedback"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));
