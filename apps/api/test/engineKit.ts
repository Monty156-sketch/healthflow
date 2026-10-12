// Plain-data builders for the engine tests. No database.
import type { ECycleRule, EContext, ERule, EShift, EStaff } from "../src/engine/types.js";
import { dayOf } from "../src/engine/time.js";

export const RULES: ERule[] = [
  { code: "C1", threshold: 8, severity: "WARN" },
  { code: "C2", threshold: 40, severity: "WARN" },
  { code: "C3", threshold: 48, severity: "BLOCK" },
  { code: "C4", threshold: 40, severity: "WARN" },
  { code: "C5", threshold: 11, severity: "BLOCK" },
  { code: "C6", threshold: 0, severity: "BLOCK" },
  { code: "C7", threshold: 6, severity: "WARN" },
  { code: "C8", threshold: 3, severity: "WARN" },
  { code: "C9", threshold: null, severity: "BLOCK" },
  { code: "C10", threshold: null, severity: "BLOCK" },
  { code: "C11", threshold: null, severity: "BLOCK" },
];

export function shift(code: string, name: string, startMin: number | null, hours: number, extra: Partial<EShift> = {}): EShift {
  return {
    id: code, code, name, startMin, durationMin: hours * 60, isOvernight: false, isOnCall: false, onCallFactor: 0,
    countsAsDuty: startMin !== null, minStaff: 0, minByCadre: {}, eligibleCadreIds: [], sortOrder: 0, ...extra,
  };
}

export const A = shift("A", "Morning", 8 * 60, 6);
export const M = shift("M", "Afternoon", 14 * 60, 6);
export const N = shift("N", "Night", 20 * 60, 12, { isOvernight: true });
export const OFF = shift("D/O", "Off Duty", null, 0);

export function person(n: number, extra: Partial<EStaff> = {}): EStaff {
  const id = `staff_${String(n).padStart(2, "0")}`;
  return { id, staffNo: id, name: id, cadreId: "nurse", departmentId: null, excludedFromNights: false, maxDutiesPerWeek: 0, eligibleShiftIds: [], ...extra };
}

export function cycle(id: string, name: string, shifts: string[], n: number, m: number, priority: number, enforcement: ECycleRule["enforcement"] = "PREFER"): ECycleRule {
  return { id, name, countingShiftIds: shifts, consecutiveDuties: n, offDaysRequired: m, cadreIds: [], departmentIds: [], enforcement, priority };
}

export const CYCLES: ECycleRule[] = [
  cycle("r2", "4 nights on, 3 off", ["N"], 4, 3, 1),
  cycle("r1", "5 days on, 2 off", ["A", "M"], 5, 2, 2),
  cycle("r3", "6 duties on, 2 off", ["A", "M", "N"], 6, 2, 3),
];

/** A period of `length` days whose first day is the given date. */
export function periodFrom(year: number, month: number, date: number, length: number) {
  const startDay = dayOf(year, month, date);
  return { startDay, endDay: startDay + length - 1 };
}

export function context(parts: Partial<EContext> & Pick<EContext, "staff" | "shifts" | "period">): EContext {
  return { assignments: [], leave: [], weekStartsOn: 1, referenceWeeks: 4, ...parts };
}
