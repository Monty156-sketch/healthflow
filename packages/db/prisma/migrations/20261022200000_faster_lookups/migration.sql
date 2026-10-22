-- Indexes for the most used reads: today's and this week's duties, attendance, waiting leave and swaps, unread notices, the audit log, open findings.
CREATE INDEX "RosterAssignment_facilityId_dutyDate_idx" ON "RosterAssignment"("facilityId", "dutyDate");
CREATE INDEX "RosterAssignment_rosterId_dutyDate_idx" ON "RosterAssignment"("rosterId", "dutyDate");
CREATE INDEX "Attendance_facilityId_dutyDate_idx" ON "Attendance"("facilityId", "dutyDate");
CREATE INDEX "Attendance_rosterAssignmentId_idx" ON "Attendance"("rosterAssignmentId");
CREATE INDEX "LeaveRequest_facilityId_status_idx" ON "LeaveRequest"("facilityId", "status");
CREATE INDEX "LeaveRequest_staffId_startDate_idx" ON "LeaveRequest"("staffId", "startDate");
CREATE INDEX "Staff_facilityId_status_idx" ON "Staff"("facilityId", "status");
CREATE INDEX "Notification_recipientEmail_readAt_idx" ON "Notification"("recipientEmail", "readAt");
CREATE INDEX "AuditLog_facilityId_createdAt_idx" ON "AuditLog"("facilityId", "createdAt");
CREATE INDEX "ComplianceFinding_rosterId_status_idx" ON "ComplianceFinding"("rosterId", "status");
CREATE INDEX "DutySwap_facilityId_status_idx" ON "DutySwap"("facilityId", "status");
