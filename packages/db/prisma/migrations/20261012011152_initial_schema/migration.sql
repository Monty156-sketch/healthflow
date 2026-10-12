-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('CHPS_COMPOUND', 'HEALTH_CENTRE', 'CLINIC', 'POLYCLINIC', 'HOSPITAL', 'PRIVATE_HOSPITAL');

-- CreateEnum
CREATE TYPE "FacilityStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLATFORM_ADMIN', 'FACILITY_ADMIN', 'ROSTER_MANAGER', 'SUPERVISOR', 'STAFF', 'DISTRICT_OFFICER');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('FACILITY', 'DISTRICT', 'PLATFORM');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PERMANENT', 'CONTRACT', 'NATIONAL_SERVICE', 'LOCUM');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TRANSFERRED', 'RESIGNED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('STATUTORY', 'POLICY', 'LOGICAL', 'FACILITY', 'FAIRNESS');

-- CreateEnum
CREATE TYPE "RuleBehaviour" AS ENUM ('BLOCK', 'WARN', 'OPTIMISE');

-- CreateEnum
CREATE TYPE "CycleEnforcement" AS ENUM ('BLOCK', 'PREFER');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('DRAFT', 'GENERATED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('GENERATED', 'MANUAL', 'SWAP', 'COVER', 'REST_BLOCK');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('BLOCK', 'WARN', 'INFO');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'OVERRIDDEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DeductionBasis" AS ENUM ('CALENDAR_DAYS', 'SCHEDULED_DUTY_DAYS', 'WORKING_DAYS_MON_FRI');

-- CreateEnum
CREATE TYPE "ReturnDateSetBy" AS ENUM ('IN_CHARGE', 'STAFF_CONFIRMS');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('NOT_DUE', 'DUE', 'CONFIRMED', 'OVERDUE', 'EXTENDED', 'RETURNED_EARLY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'OFF_DUTY', 'ON_LEAVE', 'OFFICIAL_ASSIGNMENT');

-- CreateEnum
CREATE TYPE "SwapType" AS ENUM ('EXCHANGE', 'HANDOVER');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'ACTION', 'URGENT');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PHOTOGRAPH', 'CASE_STUDY', 'REFERENCE', 'MARKETING');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE', 'OBJECTION', 'PORTABILITY');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED');

-- CreateEnum
CREATE TYPE "DistrictScope" AS ENUM ('COVERAGE', 'STAFFING', 'ATTENDANCE', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ErrorReportStatus" AS ENUM ('NEW', 'INVESTIGATING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('OPEN', 'PARTLY_SETTLED', 'SETTLED', 'WRITTEN_OFF', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('ABSENCE_COVER', 'SWAP_HANDOVER', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CoverProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AcknowledgementState" AS ENUM ('NOT_REQUIRED', 'AWAITING', 'CONFIRMED', 'DECLINED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'AGREEMENT_SENT', 'PROVISIONED', 'DECLINED', 'DORMANT');

-- CreateEnum
CREATE TYPE "AccessRequestSource" AS ENUM ('LANDING_PAGE', 'PRICING_PAGE', 'CONTACT_PAGE', 'REFERRAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportAccessLevel" AS ENUM ('READ_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "SupportSessionEndReason" AS ENUM ('MANUAL', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('INFO', 'IMPORTANT', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'SELECTED');

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityType" "FacilityType" NOT NULL,
    "ghsFacilityCode" TEXT,
    "districtId" TEXT,
    "subDistrict" TEXT,
    "region" TEXT,
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "referencePeriodWeeks" INTEGER NOT NULL DEFAULT 4,
    "leaveYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "allowNegativeLeaveBalance" BOOLEAN NOT NULL DEFAULT false,
    "attendanceCutoffDays" INTEGER NOT NULL DEFAULT 7,
    "swapCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "dpcRegistrationNumber" TEXT,
    "dpcRegistrationExpiry" TIMESTAMP(3),
    "dataProtectionContactName" TEXT,
    "dataProtectionContactEmail" TEXT,
    "status" "FacilityStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "fairnessToleranceDuties" INTEGER NOT NULL DEFAULT 1,
    "fairnessToleranceNights" INTEGER NOT NULL DEFAULT 1,
    "fairnessCarryoverMonths" INTEGER NOT NULL DEFAULT 3,
    "fairnessCarryoverDamping" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "autoAssignCover" BOOLEAN NOT NULL DEFAULT true,
    "maxSettlementPerMonth" INTEGER NOT NULL DEFAULT 4,
    "ledgerExpiryMonths" INTEGER NOT NULL DEFAULT 6,
    "coverAckWindowHours" INTEGER NOT NULL DEFAULT 4,
    "coverAckUrgentHours" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cadre" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Cadre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "cadreId" TEXT,
    "departmentId" TEXT,
    "position" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'PERMANENT',
    "status" "StaffStatus" NOT NULL DEFAULT 'PENDING',
    "dateJoined" TIMESTAMP(3),
    "photoUrl" TEXT,
    "photoConsentId" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "excludedFromNights" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "maxDutiesPerWeek" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "staffId" TEXT,
    "role" "Role" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "facilityId" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "recoveryCodesHashed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastSignInAt" TIMESTAMP(3),
    "privacyNoticeVersionAccepted" TEXT,
    "notificationPreferences" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userProfileId" TEXT NOT NULL,
    "facilityId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOvernight" BOOLEAN NOT NULL DEFAULT false,
    "isOnCall" BOOLEAN NOT NULL DEFAULT false,
    "onCallHoursFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStaff" INTEGER NOT NULL DEFAULT 0,
    "minByCadre" JSONB NOT NULL DEFAULT '{}',
    "colour" TEXT,
    "countsAsDuty" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "eligibleCadreIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstraintRule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "thresholdValue" DOUBLE PRECISION,
    "unit" TEXT,
    "behaviour" "RuleBehaviour" NOT NULL,
    "overridable" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,

    CONSTRAINT "ConstraintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyCycleRule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "consecutiveDuties" INTEGER NOT NULL,
    "offDaysRequired" INTEGER NOT NULL,
    "offDaysConsecutive" BOOLEAN NOT NULL DEFAULT true,
    "applicableCadreIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicableDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforcement" "CycleEnforcement" NOT NULL DEFAULT 'PREFER',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextShiftAfterRestId" TEXT,
    "blockShiftPatternIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DutyCycleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotation" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicableCadreIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicableDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforcement" "CycleEnforcement" NOT NULL DEFAULT 'PREFER',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShiftRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roster" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT,
    "status" "RosterStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "preparedBy" TEXT,
    "approvedBy" TEXT,
    "generatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "generationSeconds" DOUBLE PRECISION,
    "attendanceCompleteness" DOUBLE PRECISION,
    "hasUnresolvedConflicts" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterAssignment" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "dutyDate" DATE NOT NULL,
    "source" "AssignmentSource" NOT NULL DEFAULT 'GENERATED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "coverForStaffId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementState" "AcknowledgementState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterVersionSnapshot" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "assignments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "RosterVersionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceFinding" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "dutyDate" DATE,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "requiresReassignment" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideBy" TEXT,
    "overrideAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "colour" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "affectsAvailability" BOOLEAN NOT NULL DEFAULT true,
    "countsAgainstEntitlement" BOOLEAN NOT NULL DEFAULT false,
    "deductionBasis" "DeductionBasis" NOT NULL DEFAULT 'CALENDAR_DAYS',
    "maxConsecutiveDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isShortAbsence" BOOLEAN NOT NULL DEFAULT false,
    "createsDutyDebt" BOOLEAN NOT NULL DEFAULT false,
    "maxDaysForAutoCover" INTEGER NOT NULL DEFAULT 3,
    "returnDateSetBy" "ReturnDateSetBy" NOT NULL DEFAULT 'STAFF_CONFIRMS',

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEntitlement" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leaveYear" INTEGER NOT NULL,
    "daysEntitled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysCarriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysDeducted" DOUBLE PRECISION,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdBy" TEXT,
    "conflictsPublishedRoster" BOOLEAN NOT NULL DEFAULT false,
    "isOpenEnded" BOOLEAN NOT NULL DEFAULT false,
    "expectedReturnDate" DATE,
    "actualReturnDate" DATE,
    "returnStatus" "ReturnStatus" NOT NULL DEFAULT 'NOT_DUE',
    "returnConfirmedAt" TIMESTAMP(3),
    "returnConfirmedBy" TEXT,
    "extensionOfId" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "rosterId" TEXT,
    "rosterAssignmentId" TEXT,
    "dutyDate" DATE NOT NULL,
    "shiftId" TEXT,
    "status" "AttendanceStatus" NOT NULL,
    "minutesLate" INTEGER,
    "note" TEXT,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalStatus" "AttendanceStatus",
    "correctedBy" TEXT,
    "correctedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutySwap" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "swapType" "SwapType" NOT NULL,
    "requesterStaffId" TEXT NOT NULL,
    "requesterAssignmentId" TEXT NOT NULL,
    "targetStaffId" TEXT NOT NULL,
    "targetAssignmentId" TEXT,
    "reason" TEXT,
    "status" "SwapStatus" NOT NULL DEFAULT 'REQUESTED',
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "revalidationResult" JSONB,

    CONSTRAINT "DutySwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientStaffId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "token" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "recordedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requestType" "DataSubjectRequestType" NOT NULL,
    "description" TEXT,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "outcomeNote" TEXT,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "retentionMonths" INTEGER NOT NULL,
    "basisNote" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyNotice" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "PrivacyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachRecord" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "affectedStaffCount" INTEGER,
    "severity" TEXT,
    "controllerNotifiedAt" TIMESTAMP(3),
    "dpcNotified" BOOLEAN NOT NULL DEFAULT false,
    "dpcNotifiedAt" TIMESTAMP(3),
    "containment" TEXT,
    "resolution" TEXT,
    "recordedBy" TEXT,

    CONSTRAINT "BreachRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistrictGrant" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "scopes" "DistrictScope"[],
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DistrictGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstablishmentPost" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "cadreId" TEXT NOT NULL,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "EstablishmentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorReport" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "reportedBy" TEXT,
    "screen" TEXT,
    "description" TEXT NOT NULL,
    "technicalContext" JSONB,
    "status" "ErrorReportStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyLedgerEntry" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "duties" INTEGER NOT NULL,
    "dutiesSettled" INTEGER NOT NULL DEFAULT 0,
    "status" "LedgerStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "LedgerReason" NOT NULL,
    "description" TEXT,
    "relatedLeaveRequestId" TEXT,
    "relatedSwapId" TEXT,
    "counterpartyStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "writtenOffBy" TEXT,
    "writtenOffReason" TEXT,

    CONSTRAINT "DutyLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverProposal" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rosterAssignmentId" TEXT NOT NULL,
    "absentStaffId" TEXT NOT NULL,
    "dutyDate" DATE NOT NULL,
    "shiftId" TEXT NOT NULL,
    "proposedStaffId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB,
    "status" "CoverProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityAccessCode" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "FacilityAccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementAcceptance" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "documentSlug" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "acceptedByName" TEXT NOT NULL,
    "acceptedByRole" TEXT NOT NULL,
    "acceptedByEmail" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AgreementAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "summaryOfChanges" TEXT,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "facilityType" "FacilityType",
    "district" TEXT,
    "region" TEXT,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "staffCountEstimate" INTEGER,
    "currentMethod" TEXT,
    "message" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'NEW',
    "assignedTo" TEXT,
    "notes" TEXT,
    "source" "AccessRequestSource" NOT NULL DEFAULT 'LANDING_PAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceGhs" DOUBLE PRECISION NOT NULL,
    "setupPriceGhs" DOUBLE PRECISION,
    "staffBandMin" INTEGER,
    "staffBandMax" INTEGER,
    "features" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "lineItems" JSONB NOT NULL,
    "subtotalGhs" DOUBLE PRECISION NOT NULL,
    "totalGhs" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "pdfUrl" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "platformUserEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "accessLevel" "SupportAccessLevel" NOT NULL DEFAULT 'READ_ONLY',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" "SupportSessionEndReason",

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'INFO',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "facilityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabledGlobally" BOOLEAN NOT NULL DEFAULT false,
    "enabledForFacilityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ShiftEligibleStaff" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ShiftEligibleStaff_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RotationSequence" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RotationSequence_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CycleCountingShifts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CycleCountingShifts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Facility_districtId_idx" ON "Facility"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE INDEX "Department_facilityId_idx" ON "Department"("facilityId");

-- CreateIndex
CREATE INDEX "Cadre_facilityId_idx" ON "Cadre"("facilityId");

-- CreateIndex
CREATE INDEX "Staff_facilityId_idx" ON "Staff"("facilityId");

-- CreateIndex
CREATE INDEX "Staff_cadreId_idx" ON "Staff"("cadreId");

-- CreateIndex
CREATE INDEX "Staff_departmentId_idx" ON "Staff"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_facilityId_staffNo_key" ON "Staff"("facilityId", "staffNo");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userEmail_key" ON "UserProfile"("userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_staffId_key" ON "UserProfile"("staffId");

-- CreateIndex
CREATE INDEX "UserProfile_facilityId_idx" ON "UserProfile"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userProfileId_idx" ON "RefreshToken"("userProfileId");

-- CreateIndex
CREATE INDEX "Shift_facilityId_idx" ON "Shift"("facilityId");

-- CreateIndex
CREATE INDEX "ConstraintRule_facilityId_idx" ON "ConstraintRule"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstraintRule_facilityId_code_key" ON "ConstraintRule"("facilityId", "code");

-- CreateIndex
CREATE INDEX "DutyCycleRule_facilityId_idx" ON "DutyCycleRule"("facilityId");

-- CreateIndex
CREATE INDEX "ShiftRotation_facilityId_idx" ON "ShiftRotation"("facilityId");

-- CreateIndex
CREATE INDEX "Roster_facilityId_idx" ON "Roster"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Roster_facilityId_month_year_key" ON "Roster"("facilityId", "month", "year");

-- CreateIndex
CREATE INDEX "RosterAssignment_rosterId_idx" ON "RosterAssignment"("rosterId");

-- CreateIndex
CREATE INDEX "RosterAssignment_staffId_dutyDate_idx" ON "RosterAssignment"("staffId", "dutyDate");

-- CreateIndex
CREATE INDEX "RosterVersionSnapshot_rosterId_idx" ON "RosterVersionSnapshot"("rosterId");

-- CreateIndex
CREATE INDEX "ComplianceFinding_rosterId_idx" ON "ComplianceFinding"("rosterId");

-- CreateIndex
CREATE INDEX "ComplianceFinding_staffId_idx" ON "ComplianceFinding"("staffId");

-- CreateIndex
CREATE INDEX "LeaveType_facilityId_idx" ON "LeaveType"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_facilityId_code_key" ON "LeaveType"("facilityId", "code");

-- CreateIndex
CREATE INDEX "LeaveEntitlement_facilityId_idx" ON "LeaveEntitlement"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlement_staffId_leaveTypeId_leaveYear_key" ON "LeaveEntitlement"("staffId", "leaveTypeId", "leaveYear");

-- CreateIndex
CREATE INDEX "LeaveRequest_facilityId_idx" ON "LeaveRequest"("facilityId");

-- CreateIndex
CREATE INDEX "LeaveRequest_staffId_idx" ON "LeaveRequest"("staffId");

-- CreateIndex
CREATE INDEX "PublicHoliday_facilityId_idx" ON "PublicHoliday"("facilityId");

-- CreateIndex
CREATE INDEX "Attendance_facilityId_idx" ON "Attendance"("facilityId");

-- CreateIndex
CREATE INDEX "Attendance_staffId_dutyDate_idx" ON "Attendance"("staffId", "dutyDate");

-- CreateIndex
CREATE INDEX "DutySwap_facilityId_idx" ON "DutySwap"("facilityId");

-- CreateIndex
CREATE INDEX "DutySwap_rosterId_idx" ON "DutySwap"("rosterId");

-- CreateIndex
CREATE INDEX "Notification_facilityId_idx" ON "Notification"("facilityId");

-- CreateIndex
CREATE INDEX "Notification_recipientStaffId_idx" ON "Notification"("recipientStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_token_key" ON "StaffInvitation"("token");

-- CreateIndex
CREATE INDEX "StaffInvitation_facilityId_idx" ON "StaffInvitation"("facilityId");

-- CreateIndex
CREATE INDEX "ConsentRecord_facilityId_idx" ON "ConsentRecord"("facilityId");

-- CreateIndex
CREATE INDEX "ConsentRecord_staffId_idx" ON "ConsentRecord"("staffId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_facilityId_idx" ON "DataSubjectRequest"("facilityId");

-- CreateIndex
CREATE INDEX "RetentionPolicy_facilityId_idx" ON "RetentionPolicy"("facilityId");

-- CreateIndex
CREATE INDEX "PrivacyNotice_facilityId_idx" ON "PrivacyNotice"("facilityId");

-- CreateIndex
CREATE INDEX "BreachRecord_facilityId_idx" ON "BreachRecord"("facilityId");

-- CreateIndex
CREATE INDEX "DistrictGrant_districtId_idx" ON "DistrictGrant"("districtId");

-- CreateIndex
CREATE INDEX "DistrictGrant_facilityId_idx" ON "DistrictGrant"("facilityId");

-- CreateIndex
CREATE INDEX "EstablishmentPost_facilityId_idx" ON "EstablishmentPost"("facilityId");

-- CreateIndex
CREATE INDEX "AuditLog_facilityId_idx" ON "AuditLog"("facilityId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ErrorReport_facilityId_idx" ON "ErrorReport"("facilityId");

-- CreateIndex
CREATE INDEX "DutyLedgerEntry_facilityId_idx" ON "DutyLedgerEntry"("facilityId");

-- CreateIndex
CREATE INDEX "DutyLedgerEntry_staffId_idx" ON "DutyLedgerEntry"("staffId");

-- CreateIndex
CREATE INDEX "CoverProposal_facilityId_idx" ON "CoverProposal"("facilityId");

-- CreateIndex
CREATE INDEX "CoverProposal_rosterAssignmentId_idx" ON "CoverProposal"("rosterAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityAccessCode_code_key" ON "FacilityAccessCode"("code");

-- CreateIndex
CREATE INDEX "FacilityAccessCode_facilityId_idx" ON "FacilityAccessCode"("facilityId");

-- CreateIndex
CREATE INDEX "AgreementAcceptance_facilityId_idx" ON "AgreementAcceptance"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_slug_version_key" ON "LegalDocument"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_facilityId_key" ON "Subscription"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_facilityId_idx" ON "Invoice"("facilityId");

-- CreateIndex
CREATE INDEX "SupportSession_facilityId_idx" ON "SupportSession"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "_ShiftEligibleStaff_B_index" ON "_ShiftEligibleStaff"("B");

-- CreateIndex
CREATE INDEX "_RotationSequence_B_index" ON "_RotationSequence"("B");

-- CreateIndex
CREATE INDEX "_CycleCountingShifts_B_index" ON "_CycleCountingShifts"("B");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cadre" ADD CONSTRAINT "Cadre_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "Cadre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_photoConsentId_fkey" FOREIGN KEY ("photoConsentId") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintRule" ADD CONSTRAINT "ConstraintRule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyCycleRule" ADD CONSTRAINT "DutyCycleRule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyCycleRule" ADD CONSTRAINT "DutyCycleRule_nextShiftAfterRestId_fkey" FOREIGN KEY ("nextShiftAfterRestId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roster" ADD CONSTRAINT "Roster_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterVersionSnapshot" ADD CONSTRAINT "RosterVersionSnapshot_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_extensionOfId_fkey" FOREIGN KEY ("extensionOfId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicHoliday" ADD CONSTRAINT "PublicHoliday_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_rosterAssignmentId_fkey" FOREIGN KEY ("rosterAssignmentId") REFERENCES "RosterAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_requesterStaffId_fkey" FOREIGN KEY ("requesterStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_targetStaffId_fkey" FOREIGN KEY ("targetStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientStaffId_fkey" FOREIGN KEY ("recipientStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyNotice" ADD CONSTRAINT "PrivacyNotice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachRecord" ADD CONSTRAINT "BreachRecord_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictGrant" ADD CONSTRAINT "DistrictGrant_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictGrant" ADD CONSTRAINT "DistrictGrant_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentPost" ADD CONSTRAINT "EstablishmentPost_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentPost" ADD CONSTRAINT "EstablishmentPost_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "Cadre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorReport" ADD CONSTRAINT "ErrorReport_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyLedgerEntry" ADD CONSTRAINT "DutyLedgerEntry_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyLedgerEntry" ADD CONSTRAINT "DutyLedgerEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyLedgerEntry" ADD CONSTRAINT "DutyLedgerEntry_relatedLeaveRequestId_fkey" FOREIGN KEY ("relatedLeaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyLedgerEntry" ADD CONSTRAINT "DutyLedgerEntry_relatedSwapId_fkey" FOREIGN KEY ("relatedSwapId") REFERENCES "DutySwap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyLedgerEntry" ADD CONSTRAINT "DutyLedgerEntry_counterpartyStaffId_fkey" FOREIGN KEY ("counterpartyStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverProposal" ADD CONSTRAINT "CoverProposal_proposedStaffId_fkey" FOREIGN KEY ("proposedStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAccessCode" ADD CONSTRAINT "FacilityAccessCode_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementAcceptance" ADD CONSTRAINT "AgreementAcceptance_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShiftEligibleStaff" ADD CONSTRAINT "_ShiftEligibleStaff_A_fkey" FOREIGN KEY ("A") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShiftEligibleStaff" ADD CONSTRAINT "_ShiftEligibleStaff_B_fkey" FOREIGN KEY ("B") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RotationSequence" ADD CONSTRAINT "_RotationSequence_A_fkey" FOREIGN KEY ("A") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RotationSequence" ADD CONSTRAINT "_RotationSequence_B_fkey" FOREIGN KEY ("B") REFERENCES "ShiftRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CycleCountingShifts" ADD CONSTRAINT "_CycleCountingShifts_A_fkey" FOREIGN KEY ("A") REFERENCES "DutyCycleRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CycleCountingShifts" ADD CONSTRAINT "_CycleCountingShifts_B_fkey" FOREIGN KEY ("B") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
