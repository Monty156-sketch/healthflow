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
