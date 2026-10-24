-- dish.ly Connect: embedded integrations via Fastn. Additive only.
CREATE TABLE "IntegrationSettings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "fastnEndOrgId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "bigOrderThresholdCents" INTEGER NOT NULL DEFAULT 1000000,
    "slackChannel" TEXT NOT NULL DEFAULT '#general',
    "sheetName" TEXT NOT NULL DEFAULT 'dish.ly daily sales',
    "ownerEmail" TEXT,
    "sendCustomersToCrm" BOOLEAN NOT NULL DEFAULT true,
    "sendShiftReports" BOOLEAN NOT NULL DEFAULT true,
    "sendKhataReminders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationSettings_restaurantId_key" ON "IntegrationSettings"("restaurantId");
ALTER TABLE "IntegrationSettings" ADD CONSTRAINT "IntegrationSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "executionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegrationEvent_restaurantId_createdAt_idx" ON "IntegrationEvent"("restaurantId", "createdAt");
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
