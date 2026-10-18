-- AlterTable
ALTER TABLE "AccessRequest" ADD COLUMN "declineReason" TEXT,
ADD COLUMN "provisionedFacilityId" TEXT;

-- CreateTable
CREATE TABLE "AccessRequestNote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRequestNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRequestNote_requestId_idx" ON "AccessRequestNote"("requestId");

-- CreateIndex
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

-- AddForeignKey
ALTER TABLE "AccessRequestNote" ADD CONSTRAINT "AccessRequestNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
