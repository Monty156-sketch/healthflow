ALTER TABLE "ClockDevice" ADD COLUMN "apiKeyHash" TEXT, ADD COLUMN "apiKeyCreatedAt" TIMESTAMP(3), ADD COLUMN "lastPushAt" TIMESTAMP(3), ADD COLUMN "lastPushCount" INTEGER;
CREATE UNIQUE INDEX "ClockDevice_apiKeyHash_key" ON "ClockDevice"("apiKeyHash");
