// What the roster manager needs to read off a finished roster: who carries
// how much (fairness), and where a cadre is short and what would fix it.
// Plain data in, plain data out, like the rest of the engine.
import type { EAssignment, ECycleRule, ELeave, EShift, EStaff, Period } from "./types.js";
import { hoursOf, isoOf, sayDay, weekdayOf } from "./time.js";

export interface InsightsInput {
  staff: EStaff[];
  shifts: EShift[];
  cycles: ECycleRule[];
  leave: ELeave[];
  holidays: number[];
  period: Period;
  /** Assignments inside the period only. */
  assignments: EAssignment[];
  cadreNames: Record<string, string>;
}

export interface WorkloadRow {
  staffId: string;
  duties: number;
  nights: number;
  weekends: number;
  holidays: number;
  hours: number;
  leaveDays: number;
  /** Why this person's load is expected to differ: "No night duties", "Morning duties only". */
  restriction: string | null;
  /** Their hours against the average for their cadre. Null when they are the only one in it. */
  against: "above" | "below" | "even" | null;
  /** One sentence for a load that stands out, saying what explains it when something does. */
  note: string | null;
}

export interface CadreWorkload {
  cadreId: string | null;
  cadreName: string;
  people: number;
  averageDuties: number;
  averageHours: number;
}

export interface CoverAdvice {
  cadreId: string;
  cadreName: string;
  shortDuties: number;
  daysAffected: number;
  firstDates: string[];
  worstShift: { name: string; short: number } | null;
  people: number;
  moreStaff: number;
  relax: { rule: string; consecutiveDuties: number; offDaysRequired: number } | null;
  leaveDuties: number;
  headline: string;
  options: string[];
}

export interface Insights {
  workload: WorkloadRow[];
  cadres: CadreWorkload[];
  advice: CoverAdvice[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function rosterInsights(input: InsightsInput): Insights {
  const { period } = input;
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const holidays = new Set(input.holidays);
  const days = period.endDay - period.startDay + 1;

  const leaveDays = new Map<string, number>();
  for (const l of input.leave) {
    const a = Math.max(l.startDay, period.startDay);
    const b = Math.min(l.endDay, period.endDay);
    if (b >= a) leaveDays.set(l.staffId, (leaveDays.get(l.staffId) ?? 0) + (b - a + 1));
  }

  // ---- workload
  const rows = new Map<string, WorkloadRow>();
  for (const s of input.staff) {
    rows.set(s.id, {
      staffId: s.id, duties: 0, nights: 0, weekends: 0, holidays: 0, hours: 0, leaveDays: leaveDays.get(s.id) ?? 0,
      restriction: s.morningOnly ? "Morning duties only" : s.excludedFromNights ? "No night duties" : null, against: null, note: null,
    });
  }
  for (const a of input.assignments) {
    const sh = shiftById.get(a.shiftId);
    const row = rows.get(a.staffId);
    if (!sh || !row || !sh.countsAsDuty || sh.isOnCall) continue;
    row.duties += 1;
    row.hours += hoursOf(sh);
    if (sh.isOvernight) row.nights += 1;
    const wd = weekdayOf(a.day);
    if (wd === 0 || wd === 6) row.weekends += 1;
    if (holidays.has(a.day)) row.holidays += 1;
  }
  for (const r of rows.values()) r.hours = round1(r.hours);

  const cadreOf = new Map(input.staff.map((s) => [s.id, s.cadreId]));
  const byCadre = new Map<string | null, WorkloadRow[]>();
  for (const r of rows.values()) {
    const k = cadreOf.get(r.staffId) ?? null;
    byCadre.set(k, [...(byCadre.get(k) ?? []), r]);
  }
  const cadres: CadreWorkload[] = [];
  for (const [cadreId, list] of byCadre) {
    const avgHours = list.reduce((n, r) => n + r.hours, 0) / list.length;
    const avgDuties = list.reduce((n, r) => n + r.duties, 0) / list.length;
    cadres.push({ cadreId, cadreName: cadreId ? input.cadreNames[cadreId] ?? "Cadre" : "No cadre set", people: list.length, averageDuties: round1(avgDuties), averageHours: round1(avgHours) });
    if (list.length < 2) continue;
    for (const r of list) {
      const gap = avgHours === 0 ? 0 : (r.hours - avgHours) / avgHours;
      r.against = gap > 0.2 ? "above" : gap < -0.2 ? "below" : "even";
      if (r.against === "even") continue;
      const diff = Math.abs(Math.round(r.hours - avgHours));
      if (r.against === "above") {
        r.note = `${diff} hours above the ${cadres[cadres.length - 1].cadreName} average.${r.restriction ? "" : " Nothing in their set-up explains it, so the roster is leaning on them."}`;
      } else {
        const why = r.leaveDays >= 3 ? `They are on approved leave for ${plural(r.leaveDays, "day", "days")}.` : r.restriction ? `${r.restriction}.` : "Nothing in their set-up explains it, so others are covering their share.";
        r.note = `${diff} hours below the ${cadres[cadres.length - 1].cadreName} average. ${why}`;
      }
    }
  }
  cadres.sort((a, b) => a.cadreName.localeCompare(b.cadreName));

  // ---- cover advice: which cadre is short, and what would close it
  const needy = input.shifts.filter((s) => s.countsAsDuty && !s.isOnCall && (s.minStaff > 0 || Object.keys(s.minByCadre).length > 0));
  const here = new Map<string, EAssignment[]>();
  for (const a of input.assignments) {
    const k = `${a.shiftId}|${a.day}`;
    here.set(k, [...(here.get(k) ?? []), a]);
  }
  interface Gap { short: number; dayList: number[]; byShift: Map<string, number> }
  const gaps = new Map<string, Gap>();
  for (let day = period.startDay; day <= period.endDay; day++) {
    for (const sh of needy) {
      const list = here.get(`${sh.id}|${day}`) ?? [];
      for (const [cid, need] of Object.entries(sh.minByCadre)) {
        const have = list.filter((a) => cadreOf.get(a.staffId) === cid).length;
        if (have >= need) continue;
        const g: Gap = gaps.get(cid) ?? { short: 0, dayList: [], byShift: new Map<string, number>() };
        g.short += need - have;
        if (!g.dayList.includes(day)) g.dayList.push(day);
        g.byShift.set(sh.name, (g.byShift.get(sh.name) ?? 0) + (need - have));
        gaps.set(cid, g);
      }
    }
  }

  const advice: CoverAdvice[] = [];
  for (const [cid, g] of gaps) {
    const name = input.cadreNames[cid] ?? "A cadre";
    const crew = input.staff.filter((s) => s.cadreId === cid);
    const people = crew.length;
    const worked = crew.reduce((n, s) => n + (rows.get(s.id)?.duties ?? 0), 0);
    const perPerson = people ? worked / people : 0;
    const moreStaff = perPerson > 0 ? Math.max(1, Math.ceil(g.short / perPerson)) : Math.max(1, Math.ceil(g.short / Math.max(1, days / 2)));

    // The strictest off-day rule for this cadre, and whether easing it by one day would close the gap.
    const applicable = input.cycles.filter((r) => !r.cadreIds.length || r.cadreIds.includes(cid));
    const density = (n: number, m: number) => n / (n + m);
    const strictest = applicable.length ? applicable.reduce((a, b) => (density(b.consecutiveDuties, b.offDaysRequired) < density(a.consecutiveDuties, a.offDaysRequired) ? b : a)) : null;
    let relax: CoverAdvice["relax"] = null;
    if (strictest && perPerson > 0) {
      const now = density(strictest.consecutiveDuties, strictest.offDaysRequired);
      for (let off = strictest.offDaysRequired - 1; off >= 1; off--) {
        const capacity = people * perPerson * (density(strictest.consecutiveDuties, off) / now);
        if (capacity >= worked + g.short) {
          relax = { rule: strictest.name, consecutiveDuties: strictest.consecutiveDuties, offDaysRequired: off };
          break;
        }
      }
    }

    const worst = [...g.byShift.entries()].sort((a, b) => b[1] - a[1])[0];
    const days_ = [...g.dayList].sort((a, b) => a - b);
    const leaveDuties = Math.round(crew.reduce((n, s) => n + (leaveDays.get(s.id) ?? 0), 0) * (perPerson / days));
    const options: string[] = [];
    options.push(`Add at least ${moreStaff} more to the ${name} cadre. Each ${name} on this roster works about ${Math.round(perPerson)} duties a month.`);
    if (relax) options.push(`Ease "${relax.rule}" for ${name} to ${relax.consecutiveDuties} on, ${relax.offDaysRequired} off. That should be enough, but it means shorter rests.`);
    if (worst && worst[1] / g.short >= 0.5 && g.byShift.size > 1) options.push(`${worst[1]} of the ${g.short} missing duties are on the ${worst[0]} shift. Not requiring a ${name} on every ${worst[0]} would close most of the gap.`);
    if (leaveDuties > 0) options.push(`Approved leave takes about ${plural(leaveDuties, "duty", "duties")} from this cadre this month, so part of the gap is temporary.`);
    advice.push({
      cadreId: cid, cadreName: name, shortDuties: g.short, daysAffected: days_.length, firstDates: days_.slice(0, 3).map(isoOf),
      worstShift: worst ? { name: worst[0], short: worst[1] } : null, people, moreStaff, relax, leaveDuties,
      headline: `${name}: short by ${plural(g.short, "duty", "duties")} on ${plural(days_.length, "day", "days")}. ${plural(people, "person", "people")} in this cadre covered ${worked} of the ${worked + g.short} duties the shifts ask for. First short on ${days_.slice(0, 3).map(sayDay).join(", ")}.`,
      options,
    });
  }
  advice.sort((a, b) => b.shortDuties - a.shortDuties);
  return { workload: [...rows.values()], cadres, advice };
}
