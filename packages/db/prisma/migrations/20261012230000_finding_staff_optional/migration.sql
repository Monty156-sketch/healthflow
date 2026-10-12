-- DropForeignKey
ALTER TABLE "ComplianceFinding" DROP CONSTRAINT "ComplianceFinding_staffId_fkey";

-- AlterTable
ALTER TABLE "ComplianceFinding" ALTER COLUMN "staffId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
