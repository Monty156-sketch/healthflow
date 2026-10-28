-- Shift handover notes and who has read them.
CREATE TABLE "HandoverNote" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT,
    "shiftId" TEXT NOT NULL,
    "dutyDate" DATE NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pending" TEXT,
    "concerns" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HandoverNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HandoverRead" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "readerEmail" TEXT NOT NULL,
    "readerName" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HandoverRead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HandoverNote_facilityId_departmentId_dutyDate_idx" ON "HandoverNote"("facilityId", "departmentId", "dutyDate");
CREATE UNIQUE INDEX "HandoverRead_noteId_readerEmail_key" ON "HandoverRead"("noteId", "readerEmail");

ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandoverRead" ADD CONSTRAINT "HandoverRead_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "HandoverNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
