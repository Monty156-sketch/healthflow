-- Sick leave has no fixed end: the person says the day they are back. Facilities
-- created before this was the default still have the in-charge setting a date.
-- Only the seeded Sick type is changed, and only while it still has the old default.
UPDATE "LeaveType" SET "returnDateSetBy" = 'STAFF_CONFIRMS' WHERE "code" = 'SK' AND "name" = 'Sick' AND "returnDateSetBy" = 'IN_CHARGE';
