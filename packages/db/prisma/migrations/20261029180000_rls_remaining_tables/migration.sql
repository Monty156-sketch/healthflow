-- Row-level security for the tables the first migration left open.
-- Same rules as before: ENABLE (not FORCE), so the table owner is unaffected and nothing changes until
-- RLS_ENFORCE=on and the API connects as a non-owner role. Forward-only; undo with DISABLE ROW LEVEL SECURITY.
-- Left open on purpose: UserProfile and RefreshToken (sign-in, invitations and email-uniqueness checks look across facilities).

ALTER TABLE "DistrictGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "DistrictGrant"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "FacilityAccessCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "FacilityAccessCode"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "Subscription"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "Invoice"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "SupportSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "SupportSession"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "AnnouncementSeen" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "AnnouncementSeen"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "WardTransfer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "WardTransfer"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "Deployment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "Deployment"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "AuditLog"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true) OR "facilityId" IS NULL);

ALTER TABLE "ErrorReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "ErrorReport"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true) OR "facilityId" IS NULL);

ALTER TABLE "PublicHoliday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON "PublicHoliday"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true) OR "facilityId" IS NULL)
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "facilityId" = current_setting('app.facility_id', true));
