-- Brings existing facilities in line with how Ghana Health Service facilities usually roster these cadres.
-- Office hours, weekday day shift only: pharmacy, laboratory, imaging, therapy, records, disease control, physician assistants.
UPDATE "Cadre" SET "weekdaysOnly" = true, "takesNights" = false
WHERE "weekdaysOnly" = false AND "onRoster" = true
  AND "name" ~* '(pharmac|laborator|radiograph|physiotherap|dietic|nutrition|dental|disease control|health information|records|physician assistant|medical assistant|public health|environmental)';

-- Accountants and administrators are not on the duty roster.
UPDATE "Cadre" SET "onRoster" = false, "takesNights" = false, "weekdaysOnly" = false
WHERE "name" ~* '(accountant|administrator)';

-- Security, drivers and orderlies cover 24 hours.
UPDATE "Cadre" SET "takesNights" = true
WHERE "weekdaysOnly" = false AND "onRoster" = true AND "name" ~* '(security|driver|orderl|ward assistant|porter)';

-- Senior grades can take charge of a shift.
UPDATE "Staff" SET "canLead" = true
WHERE "canLead" = false AND "position" ~* '(senior|principal|chief|in[- ]?charge|nurse manager|matron|sister|deputy director|head of|supervisor)';
