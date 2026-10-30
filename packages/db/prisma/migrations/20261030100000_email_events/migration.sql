-- Whether emails are getting through, for System health. Outcome only: no address, no text. Additive.
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailEvent_createdAt_idx" ON "EmailEvent"("createdAt");
