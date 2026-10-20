// Before a roster is generated: can these people cover these minimums at all,
// under the facility's own cycles and rest rules? A bound, not a simulation,
// so it can say plainly how many more people (or how much lower a minimum)
// would make the month possible, without waiting for the generator to fail.
import type { ECycleRule, ELeave, EShift, EStaff, Period, ERule } from "./types.js";
import { demandOn, dayKind } from "./demand.js";
import { hoursOf } from "./time.js";

export interface StaffingInput {
  staff: EStaff[];
  shifts: EShift[];
  cycles: ECycleRule[];
  rules: ERule[];
  leave: ELeave[];
  holidays: number[];
  period: Period;
  cadreNames?: Record<string, string>;
}

export interface StaffingCheck {
  verdict: "OK" | "TIGHT" | "SHORT";
  headline: string;
  people: number;
  nightTakers: number;
  duties: { needed: number; possible: number };
  nights: { needed: number; possible: number; takersNeeded: number };
  peopleNeeded: number;
  cadres: { cadreId: string; cadreName: string; needed: number; possible: number; people: number; peopleNeeded: number }[];
  hoursPerPerson: number;
  suggestions: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function staffingCheck(input: StaffingInput): StaffingCheck {
  const { period } = input;
  const days = period.endDay - period.startDay + 1;
  const holidays = new Set(input.holidays);
  const duty = input.shifts.filter((s) => s.countsAsDuty && !s.isOnCall && s.startMin !== null);
  const pool = input.staff.filter((s) => !s.morningOnly);
  const leaveDays = (s: EStaff) => {
    let n = 0;
    for (const l of input.leave) if (l.staffId === s.id) for (let d = Math.max(l.startDay, period.startDay); d <= Math.min(l.endDay, period.endDay); d++) n++;
    return n;
  };
  const rule = (code: string) => input.rules.find((r) => r.code === code);
  // The weekly unbroken rest leaves at most five working days in seven when it is 48 hours, six when it is 24.
  const c3 = rule("C3");
  const weekShare = c3 ? (c3.threshold ?? 48) >= 48 ? 5 / 7 : 6 / 7 : 1;
  const kinded = (night: boolean) =>
    input.cycles.filter((c) => {
      const counted = c.countingShiftIds.map((id) => duty.find((x) => x.id === id)).filter(Boolean) as EShift[];
      return counted.length > 0 && counted.every((x) => x.isOvernight === night);
    });
  const density = (rs: ECycleRule[]) => (rs.length ? Math.min(...rs.map((r) => r.consecutiveDuties / (r.consecutiveDuties + r.offDaysRequired))) : 1);
  // Days off in the month (C14) cap everyone's share too.
  const c14 = rule("C14");
  const offShare = c14 ? Math.max(0, days - (c14.threshold ?? 8)) / days : 1;
  const dayDensity = Math.min(weekShare, offShare, density(kinded(false)));
  const nightDensity = Math.min(weekShare, offShare, density(kinded(true)));

  // In-charges work their weekday mornings whatever happens; they come off the morning demand first.
  const inCharge = input.staff.filter((s) => s.morningOnly);
  let needed = 0;
  let nightNeeded = 0;
  let hoursNeeded = 0;
  const cadreNeed = new Map<string, number>();
  for (let d = period.startDay; d <= period.endDay; d++) {
    const kind = dayKind(d, holidays);
    for (const x of duty) {
      const need = demandOn(x, d, holidays);
      let total = Math.max(need.minStaff, Object.values(need.minByCadre).reduce((t, v) => t + v, 0));
      if (kind === "WEEKDAY" && x === duty.filter((y) => !y.isOvernight).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))[0]) total = Math.max(0, total - inCharge.length);
      needed += total;
      hoursNeeded += total * hoursOf(x);
      if (x.isOvernight) nightNeeded += total;
      for (const [cid, v] of Object.entries(need.minByCadre)) cadreNeed.set(cid, (cadreNeed.get(cid) ?? 0) + v);
    }
  }

  const takers = pool.filter((s) => !s.excludedFromNights && duty.some((x) => x.isOvernight));
  const avail = (s: EStaff) => days - leaveDays(s);
  const possible = Math.floor(pool.reduce((t, s) => t + avail(s) * dayDensity, 0));
  const nightPossible = Math.floor(takers.reduce((t, s) => t + avail(s) * nightDensity, 0));
  const perPerson = days * dayDensity;
  const peopleNeeded = Math.ceil(needed / Math.max(1, perPerson));
  const takersNeeded = nightNeeded ? Math.ceil(nightNeeded / Math.max(1, days * nightDensity)) : 0;

  const cadres = [...cadreNeed].map(([cadreId, need]) => {
    const people = pool.filter((s) => s.cadreId === cadreId);
    return {
      cadreId, cadreName: input.cadreNames?.[cadreId] ?? "A cadre", needed: need,
      possible: Math.floor(people.reduce((t, s) => t + avail(s) * dayDensity, 0)), people: people.length,
      peopleNeeded: Math.ceil(need / Math.max(1, perPerson)),
    };
  });

  const suggestions: string[] = [];
  const short = needed - possible;
  const nightShort = nightNeeded - nightPossible;
  if (short > 0) suggestions.push(`Add about ${plural(Math.max(1, peopleNeeded - pool.length), "person", "people")} to the roster, or lower some minimums by about ${plural(short, "duty", "duties")} across the month.`);
  if (nightShort > 0) suggestions.push(`Nights need about ${plural(takersNeeded, "person", "people")} who take them; ${takers.length} do. Allow more staff to take nights, or ask for one fewer at night on some days.`);
  if (short > 0 || nightShort > 0) {
    const weekendDays = [...Array(days)].map((_, i) => period.startDay + i).filter((d) => dayKind(d, holidays) !== "WEEKDAY").length;
    if (weekendDays && duty.some((x) => (x.weekendMinStaff ?? null) === null)) suggestions.push(`Set a lower minimum for Saturdays, Sundays and public holidays under Shifts: ${plural(weekendDays, "day", "days")} this month would need fewer people.`);
    suggestions.push("Say which shift may run short first under Shifts, so any gap lands where it does least harm.");
  }
  for (const c of cadres) if (c.needed > c.possible) suggestions.push(`${c.cadreName}: the minimums ask for ${c.needed} duties and ${plural(c.people, "person", "people")} can give about ${c.possible}. About ${c.peopleNeeded} would cover it.`);

  const margin = possible - needed;
  const verdict: StaffingCheck["verdict"] = short > 0 || nightShort > 0 || cadres.some((c) => c.needed > c.possible) ? "SHORT" : margin < needed * 0.08 ? "TIGHT" : "OK";
  const headline =
    verdict === "SHORT"
      ? `These minimums need about ${plural(needed, "duty", "duties")} this month and your ${plural(pool.length, "person", "people")} can give about ${possible} within the rest rules${nightShort > 0 ? `; nights are short by about ${nightShort}` : ""}. Expect gaps, or change the numbers first.`
      : verdict === "TIGHT"
        ? `Just enough: about ${possible} duties possible for ${needed} needed. Any leave this month will leave gaps.`
        : `Enough people: about ${possible} duties possible for ${needed} needed.`;
  return {
    verdict, headline, people: pool.length, nightTakers: takers.length,
    duties: { needed, possible }, nights: { needed: nightNeeded, possible: nightPossible, takersNeeded },
    peopleNeeded, cadres, hoursPerPerson: pool.length ? Math.round(hoursNeeded / pool.length) : 0, suggestions,
  };
}
