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
  staff: { id: string; name: string; staffNo: string; cadreId: string | null; cadreCode: string | null; cadreName: string | null; cadreOrder: number; departmentName: string | null }[];
  shifts: { id: string; code: string; name: string; colour: string | null; countsAsDuty: boolean; isOvernight: boolean; active: boolean; isOnCall: boolean; durationHours: number; minStaff: number; minByCadre: Record<string, number> }[];
  cadres: { id: string; name: string }[];
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
