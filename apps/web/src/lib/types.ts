// Shapes the facility API returns.

export interface GroupRef {
  id: string;
  name: string;
  code: string | null;
}

export interface Staff {
  id: string;
  staffNo: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  cadre: GroupRef | null;
  department: GroupRef | null;
  position: string | null;
  employmentStatus: string;
  status: string;
  dateJoined: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  excludedFromNights: boolean;
  exclusionReason: string | null;
  maxDutiesPerWeek: number;
  account: {
    role: string;
    active: boolean;
    lastSignInAt: string | null;
    mfaEnabled: boolean;
    privacyNoticeVersionAccepted?: string | null;
  } | null;
  hasPhoto?: boolean;
  /** Only on the detail record. */
  photo?: string | null;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  staffCount: number;
}

export interface Cadre extends Department {
  sortOrder: number;
}

export interface Shift {
  id: string;
  name: string;
  code: string;
  startTime: string | null;
  endTime: string | null;
  durationHours: number;
  isOvernight: boolean;
  isOnCall: boolean;
  onCallHoursFactor: number;
  onCallAdviceNote: string | null;
  minStaff: number;
  minByCadre: Record<string, number>;
  eligibleCadreIds: string[];
  colour: string | null;
  countsAsDuty: boolean;
  active: boolean;
  sortOrder: number;
}

export interface Rule {
  code: string;
  name: string;
  ruleType: "STATUTORY" | "POLICY" | "LOGICAL" | "FACILITY" | "FAIRNESS";
  thresholdValue: number | null;
  unit: string | null;
  behaviour: "BLOCK" | "WARN" | "OPTIMISE";
  overridable: boolean;
  enabled: boolean;
  description: string | null;
  editable: { threshold: boolean; behaviour: boolean; enabled: boolean };
  range: { min: number; max: number } | null;
  standard: number | null;
}

export interface CycleRule {
  id: string;
  name: string;
  countingShiftIds: string[];
  consecutiveDuties: number;
  offDaysRequired: number;
  offDaysConsecutive: boolean;
  applicableCadreIds: string[];
  applicableDepartmentIds: string[];
  enforcement: "BLOCK" | "PREFER";
  priority: number;
  nextShiftAfterRestId: string | null;
  blockShiftPatternIds: string[];
  active: boolean;
}

export interface CapacityRow {
  cadreId: string;
  cadreName: string;
  staffCount: number;
  rule: { id: string; name: string; consecutiveDuties: number; offDaysRequired: number } | null;
  supply: number;
  demand: number;
  shortBy: number;
  achievable: boolean;
  staffNeeded: number;
  suggestion: { consecutiveDuties: number; offDaysRequired: number } | null;
}

export interface RosterSummary {
  id: string;
  year: number;
  month: number;
  label: string;
  status: "DRAFT" | "GENERATED" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";
  version: number;
  generatedAt: string | null;
  generationSeconds: number | null;
  duties: number;
  blocks: number;
  warnings: number;
  unfilled: number;
}

export interface RosterFinding {
  id: string;
  ruleCode: string;
  severity: "BLOCK" | "WARN" | "INFO";
  message: string;
  staffId: string | null;
  date: string | null;
  status: "OPEN" | "OVERRIDDEN" | "RESOLVED";
  overrideReason?: string | null;
  overrideBy?: string | null;
}

export interface RosterView {
  roster: Omit<RosterSummary, "duties" | "blocks" | "warnings" | "unfilled">;
  summary: { duties: number; blocks: number; warnings: number; unfilled: number };
  staff: { id: string; name: string; staffNo: string; cadreCode: string | null; cadreName: string | null; cadreOrder: number; departmentName: string | null }[];
  shifts: { id: string; code: string; name: string; colour: string | null; countsAsDuty: boolean; isOvernight: boolean; active: boolean }[];
  assignments: { staffId: string; shiftId: string; date: string; source: string; locked: boolean }[];
  findings: RosterFinding[];
}

export interface Shortfall {
  date: string;
  shift: string;
  cadre: string | null;
  required: number;
  available: number;
  sentence: string;
}

export interface LeaveTypeLite {
  id: string;
  code: string;
  name: string;
  colour: string | null;
  countsAgainstEntitlement: boolean;
  deductionBasis: string;
}

export interface LeaveRequestRow {
  id: string;
  staffId: string;
  staffName: string;
  cadreName: string | null;
  leaveTypeId: string;
  typeName: string;
  typeCode: string;
  colour: string | null;
  startDate: string;
  endDate: string;
  days: number | null;
  reason: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy: string | null;
  decisionNote: string | null;
  expectedReturnDate: string | null;
  conflictsPublishedRoster: boolean;
}

export interface LeaveBalance {
  configured: boolean;
  entitled: number | null;
  taken: number;
  pending: number;
  remaining: number | null;
}

export interface LeaveDetail {
  request: LeaveRequestRow;
  impact: { summary: string[]; riskDates: string[]; needsReview: boolean } | null;
  balance: LeaveBalance | null;
  history: LeaveRequestRow[];
}

export interface LeaveCalendar {
  month: string;
  year: number;
  monthNumber: number;
  staff: { id: string; name: string; cadreId: string | null; cadreCode: string | null; cadreName: string | null; cadreOrder: number; departmentId: string | null; departmentName: string | null }[];
  leave: { id: string; staffId: string; code: string; typeName: string; colour: string | null; startDate: string; endDate: string; pending: boolean }[];
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export interface AttendanceDay {
  date: string;
  cutoffDays: number;
  needsReason: boolean;
  canRecord: boolean;
  blocked: string | null;
  shifts: {
    id: string;
    name: string;
    code: string;
    startTime: string | null;
    endTime: string | null;
    people: {
      assignmentId: string;
      staffId: string;
      name: string;
      cadre: string | null;
      isCover: boolean;
      record: { status: AttendanceStatus | string; minutesLate: number | null; note: string | null; needsReview: boolean; corrected: boolean; originalStatus: string | null } | null;
    }[];
  }[];
  onLeave: { staffId: string; name: string; official: boolean; typeName: string }[];
  offDuty: { staffId: string; name: string }[];
}

export interface AttendanceMonth {
  month: string;
  published: boolean;
  completeness: number | null;
  staff: { id: string; name: string; cadreName: string | null; departmentId: string | null; departmentName: string | null }[];
  departments: { id: string; name: string }[];
  cells: { staffId: string; date: string; code: string; needsReview?: boolean }[];
}
