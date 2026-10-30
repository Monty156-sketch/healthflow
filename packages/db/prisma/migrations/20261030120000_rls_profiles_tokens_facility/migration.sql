-- Row-level security for the last three open tables: people's accounts, their sign-in tokens, and the facility row itself.
-- Same rules as the other tables: ENABLE (not FORCE), so the table owner is unaffected and nothing changes until
-- RLS_ENFORCE=on and the API connects as a non-owner role. Forward-only; undo with DISABLE ROW LEVEL SECURITY.
-- Sign-in, registration, invitations and the console run as trusted system work (see lib/tenant.ts), which bypasses these.
-- A facility user sees only their own facility's accounts and tokens, and only their own facility row.
-- Accounts with no facility (platform staff, district and region officers) are visible to system work only.

ALTER TABLE "UserProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "UserProfile"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "RefreshToken"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "Facility"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "id" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "id" = current_setting('app.facility_id', true));
