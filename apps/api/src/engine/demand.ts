// How many people a shift needs on a given day. A facility may ask for fewer
// (or more) at weekends and on public holidays than on weekdays.
import type { EShift } from "./types.js";
import { weekdayOf } from "./time.js";

export type DayKind = "WEEKDAY" | "WEEKEND" | "HOLIDAY";

export function dayKind(day: number, holidays: Set<number> | number[] | undefined): DayKind {
  const set = holidays instanceof Set ? holidays : new Set(holidays ?? []);
  if (set.has(day)) return "HOLIDAY";
  const w = weekdayOf(day);
  return w === 0 || w === 6 ? "WEEKEND" : "WEEKDAY";
}

/** A cadre minimum can never be more than the day's total. */
function capped(byCadre: Record<string, number>, total: number): Record<string, number> {
  return Object.fromEntries(Object.entries(byCadre).map(([k, v]) => [k, Math.min(v, total)]).filter(([, v]) => (v as number) > 0));
}

export type DemandSource = Pick<EShift, "minStaff" | "minByCadre" | "weekendMinStaff" | "weekendMinByCadre" | "holidayMinStaff" | "holidayMinByCadre">;

export function demandOn(shift: DemandSource, day: number, holidays: Set<number> | number[] | undefined): { minStaff: number; minByCadre: Record<string, number> } {
  const kind = dayKind(day, holidays);
  const weekend = shift.weekendMinStaff ?? null;
  const holiday = shift.holidayMinStaff ?? null;
  if (kind === "HOLIDAY" && holiday !== null) return { minStaff: holiday, minByCadre: capped(shift.holidayMinByCadre ?? shift.weekendMinByCadre ?? shift.minByCadre, holiday) };
  if ((kind === "HOLIDAY" || kind === "WEEKEND") && weekend !== null) return { minStaff: weekend, minByCadre: capped(shift.weekendMinByCadre ?? shift.minByCadre, weekend) };
  return { minStaff: shift.minStaff, minByCadre: shift.minByCadre };
}

/** True when the shift asks for anyone on any kind of day. */
export function hasDemand(shift: DemandSource): boolean {
  return shift.minStaff > 0 || Object.keys(shift.minByCadre).length > 0 || (shift.weekendMinStaff ?? 0) > 0 || (shift.holidayMinStaff ?? 0) > 0;
}
