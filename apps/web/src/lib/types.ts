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
  morningOnly: boolean;
  smsOptOut: boolean;
  willingForExtraDuties: boolean;
  exclusionReason: string | null;
  maxDutiesPerWeek: number;
  canLead?: boolean;
  maxNightsPerMonth?: number;
  maxHoursPerMonth?: number;
  eligibleShifts?: { id: string; name: string; code: string }[];
  account: {
    role: string;
    active: boolean;
    lastSignInAt: string | null;
    mfaEnabled: boolean;
    privacyNoticeVersionAccepted?: string | null;
    wardDepartmentId?: string | null;
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
  /** Departments only. False for one that closes at night. */
  runsNights?: boolean;
  /** Departments only. WARD: in-charge runs the roster. SUPPORT: administrator does. OFFICE: no roster. */
  kind?: "WARD" | "SUPPORT" | "OFFICE";
  /** A standard department or cadre: its night and office-hour settings are fixed. */
  locked?: boolean;
}

export interface Cadre extends Department {
  sortOrder: number;
  takesNights?: boolean;
  weekdaysOnly?: boolean;
  onRoster?: boolean;
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
  /** Null means the same as weekdays. */
  weekendMinStaff: number | null;
  /** Null means the weekend number, or the weekday number when there is none. */
  holidayMinStaff: number | null;
  /** 1 keep full first, 0 no preference, -1 may run short first. */
  keepFull: number;
  minLeads?: number;
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
  kind: "NIGHT" | "DAY";
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
  departmentId?: string | null;
  department?: string | null;
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
  /** staffId|YYYY-MM-DD -> leave or day-off code */
  marks?: Record<string, string>;
  markLegend?: { code: string; label: string }[];
  holidays?: string[];
  roster: Omit<RosterSummary, "duties" | "blocks" | "warnings" | "unfilled">;
  summary: { duties: number; blocks: number; warnings: number; unfilled: number };
  staff: { id: string; name: string; staffNo: string; cadreCode: string | null; cadreName: string | null; cadreOrder: number; departmentName: string | null }[];
  shifts: { id: string; code: string; name: string; colour: string | null; countsAsDuty: boolean; isOvernight: boolean; active: boolean }[];
  assignments: { staffId: string; shiftId: string; date: string; source: string; locked: boolean }[];
  findings: RosterFinding[];
}

export interface RosterInsights {
  workload: { staffId: string; name: string; staffNo: string; cadreName: string; duties: number; nights: number; weekends: number; holidays: number; hours: number; leaveDays: number; restriction: string | null; against: "above" | "below" | "even" | null; note: string | null }[];
  cadres: { cadreId: string | null; cadreName: string; people: number; averageDuties: number; averageHours: number }[];
  advice: { cadreId: string; cadreName: string; shortDuties: number; daysAffected: number; firstDates: string[]; worstShift: { name: string; short: number } | null; people: number; moreStaff: number; headline: string; options: string[] }[];
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
  returnDateSetBy: "IN_CHARGE" | "STAFF_CONFIRMS";
}

export type ReturnStatus = "NOT_DUE" | "DUE" | "CONFIRMED" | "OVERDUE" | "EXTENDED" | "RETURNED_EARLY";

export interface ReturnItem extends LeaveRequestRow {
  daysLate: number;
  daysAway: number;
  extensionPending: boolean;
}

export interface ReturnsDue {
  today: string;
  overdue: ReturnItem[];
  soon: ReturnItem[];
  open: ReturnItem[];
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
  isOpenEnded: boolean;
  returnDateSetBy: "IN_CHARGE" | "STAFF_CONFIRMS";
  extensionOfId: string | null;
  returnStatus: ReturnStatus | null;
  actualReturnDate: string | null;
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
      coverForName: string | null;
      coverState: string | null;
      record: { status: AttendanceStatus | string; minutesLate: number | null; note: string | null; needsReview: boolean; corrected: boolean; originalStatus: string | null } | null;
    }[];
  }[];
  covered: { absentName: string; coverName: string }[];
  onLeave: { staffId: string; name: string; official: boolean; typeName: string }[];
  offDuty: { staffId: string; name: string }[];
  review: { id: string; name: string; status: string; minutesLate: number | null }[];
}

export interface AttendanceMonth {
  month: string;
  published: boolean;
  completeness: number | null;
  staff: { id: string; name: string; cadreName: string | null; departmentId: string | null; departmentName: string | null }[];
  departments: { id: string; name: string }[];
  cells: { staffId: string; date: string; code: string; needsReview?: boolean }[];
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  severity: "INFO" | "ACTION" | "URGENT";
  read: boolean;
  createdAt: string;
}

export interface MyDuties {
  linked: boolean;
  month: string;
  duties: {
    assignmentId: string;
    date: string;
    shift: { name: string; code: string; startTime: string | null; endTime: string | null; colour: string | null };
    past: boolean;
    attendance: { status: string; minutesLate: number | null; corrected: boolean } | null;
  }[];
}

export interface SwapRow {
  id: string;
  type: "EXCHANGE" | "HANDOVER";
  status: "REQUESTED" | "ACCEPTED" | "DECLINED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  reason: string | null;
  responseNote: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  requesterId: string;
  requester: string;
  targetId: string;
  target: string;
  gives: { date: string; shift: string } | null;
  takes: { date: string; shift: string } | null;
  month: string;
}

export interface SwapCandidates {
  duty: { id: string; date: string; shift: string };
  handover: { staffId: string; name: string; cadre: string | null; warnings: string[] }[];
  colleagues: { staffId: string; name: string; cadre: string | null }[];
}

export interface LeaveTypeFull {
  id: string;
  name: string;
  code: string;
  colour: string | null;
  isPaid: boolean;
  affectsAvailability: boolean;
  countsAgainstEntitlement: boolean;
  deductionBasis: "CALENDAR_DAYS" | "SCHEDULED_DUTY_DAYS" | "WORKING_DAYS_MON_FRI";
  maxConsecutiveDays: number | null;
  createsDutyDebt: boolean;
  isShortAbsence: boolean;
  maxDaysForAutoCover: number;
  returnDateSetBy: "IN_CHARGE" | "STAFF_CONFIRMS";
  active: boolean;
  sortOrder: number;
}

export interface EntitlementRow {
  staffId: string;
  name: string;
  staffNo: string;
  cadre: string | null;
  configured: boolean;
  daysEntitled: number | null;
  daysCarriedOver: number;
  taken: number;
  pending: number;
  remaining: number | null;
}

export interface CoverOption {
  proposalId: string;
  rank: number;
  staffId: string;
  name: string;
  cadre: string | null;
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface CoverOptions {
  duty: { id: string; date: string; shift: string; holder: string };
  options: CoverOption[];
  ruledOut: { name: string; why: string }[];
  summary: string;
}

export interface CoverWaiting {
  assignmentId: string;
  date: string;
  shift: string;
  startTime: string | null;
  staffId: string;
  coverName: string;
  forName: string | null;
  state: "AWAITING" | "ESCALATED";
  notifiedAt: string | null;
  mine: boolean;
}

export interface LedgerEntryRow {
  id: string;
  staffId: string;
  staffName: string;
  type: "DEBT" | "CREDIT";
  duties: number;
  settled: number;
  status: "OPEN" | "PARTLY_SETTLED" | "SETTLED" | "WRITTEN_OFF" | "EXPIRED";
  reason: "ABSENCE_COVER" | "SWAP_HANDOVER" | "MANUAL_ADJUSTMENT";
  description: string | null;
  counterparty: string | null;
  createdAt: string;
  expiresAt: string | null;
  writtenOffReason: string | null;
}

export interface Ledger {
  summary: { openDebts: number; openCredits: number; balanced: boolean; line: string };
  people: { staffId: string; name: string; cadre: string | null; owes: number; owed: number }[];
  staff: { id: string; name: string }[];
  entries: LedgerEntryRow[];
}

export interface ComplianceReport {
  month: string;
  title?: string;
  roster: { id: string; status: string; version: number } | null;
  rows?: {
    staffId: string;
    staffNo: string;
    name: string;
    cadre: string | null;
    ward?: string | null;
    hours: number;
    dutyDays: number;
    nights: number;
    highestWeekHours: number;
    hoursAboveNormal: number;
    longestRestHours: number | null;
    restBreaches: number;
  }[];
  overrides?: { rule: string; message: string; staff: string | null; reason: string; approver: string; date: string | null }[];
  summary?: { staffAboveNormalWeek: number; restBreaches: number; overridesGranted: number; unfilledShifts: number };
  normalWeek?: number;
  wards?: { id: string; name: string; status: string }[];
  ward?: string | null;
}

export interface FairMeans {
  nights: number;
  weekends: number;
  holidays: number;
  duties: number;
  hours: number;
}

export interface FairnessReport {
  month: string;
  period: { from: string; to: string };
  monthsCovered: number;
  monthsAsked: number;
  manager: boolean;
  cadres?: { cadre: string; means: FairMeans; sentence: string | null; people: ({ staffId: string; name: string } & FairMeans)[] }[];
  mine?: { cadre: string; means: FairMeans; me: FairMeans; peers: number } | null;
}
