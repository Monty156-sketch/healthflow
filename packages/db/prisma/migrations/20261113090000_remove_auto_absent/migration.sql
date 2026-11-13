-- Automatic absence is withdrawn: a person appears in attendance when they clock in, or when the in-charge marks them.
-- Remove the absences the system wrote by itself and nobody has touched since.
DELETE FROM "Attendance" WHERE "source" = 'AUTO' AND "correctedAt" IS NULL;
-- Records an in-charge typed in by hand are marked as such.
UPDATE "Attendance" SET "source" = 'MANUAL' WHERE "source" = 'BOOK';
