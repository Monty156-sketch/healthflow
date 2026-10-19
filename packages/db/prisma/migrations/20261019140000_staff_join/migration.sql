ALTER TABLE "Staff"
  ADD COLUMN "joinedVia" TEXT,
  ADD COLUMN "requestedCadre" TEXT,
  ADD COLUMN "requestedDepartment" TEXT,
  ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "JoinAttempt" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "verifyMethod" TEXT NOT NULL,
    "verifyCodeHash" TEXT,
    "sends" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JoinAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JoinAttempt_tokenHash_key" ON "JoinAttempt"("tokenHash");
CREATE INDEX "JoinAttempt_phone_createdAt_idx" ON "JoinAttempt"("phone", "createdAt");
CREATE INDEX "JoinAttempt_facilityId_idx" ON "JoinAttempt"("facilityId");
