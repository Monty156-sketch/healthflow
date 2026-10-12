// The roster engine works on plain data, with no database and no clock, so
// every rule and the generator can be tested alone. Dates are whole days
// counted from 1 January 1970 (UTC), and times of day are minutes.

export interface EShift {
  id: string;
  code: string;
  name: string;
  /** Minutes after midnight; null for Off Duty. */
  startMin: number | null;
  durationMin: number;
  isOvernight: boolean;
  isOnCall: boolean;
  onCallFactor: number;
  countsAsDuty: boolean;
  minStaff: number;
  minByCadre: Record<string, number>;
  eligibleCadreIds: string[];
  sortOrder: number;
}

export interface EStaff {
  id: string;
  staffNo: string;
  name: string;
  cadreId: string | null;
  departmentId: string | null;
  excludedFromNights: boolean;
  /** 0 means no limit. */
  maxDutiesPerWeek: number;
  /** Empty means every shift their cadre allows. */
  eligibleShiftIds: string[];
}

export interface EAssignment {
  staffId: string;
  shiftId: string;
  day: number;
  locked?: boolean;
}

export interface ELeave {
  staffId: string;
  startDay: number;
  endDay: number;
}

export interface ECycleRule {
  id: string;
  name: string;
  countingShiftIds: string[];
  consecutiveDuties: number;
  offDaysRequired: number;
  cadreIds: string[];
  departmentIds: string[];
  enforcement: "BLOCK" | "PREFER";
  priority: number;
  /** When this rule's rest block ends, the first duty back must be this shift. */
  nextShiftAfterRestId?: string | null;
  /** The order shifts take within a block, repeating until the block ends. */
  blockShiftPatternIds?: string[];
}

export interface ERule {
  code: string;
  threshold: number | null;
  severity: "BLOCK" | "WARN";
}

export interface Period {
  startDay: number;
  endDay: number;
}

export interface EContext {
  staff: EStaff[];
  shifts: EShift[];
  /** Includes the days before the period that the rules look back over. */
  assignments: EAssignment[];
  leave: ELeave[];
  period: Period;
  /** 0 Sunday to 6 Saturday. */
  weekStartsOn: number;
  referenceWeeks: number;
  /** For wording only: cadre id to name. */
  cadreNames?: Record<string, string>;
}

export interface Finding {
  ruleCode: string;
  severity: "BLOCK" | "WARN";
  staffId: string | null;
  day: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export type Evaluator = (rule: ERule, ctx: EContext) => Finding[];
