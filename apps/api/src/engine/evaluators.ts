// The compliance rule registry (spec AD2). Every rule is one function with
// the same signature, and a rule's code maps to its function. Adding C13 is
// one new function and one new row here. Each can be tested on its own.
import { demandOn, hasDemand } from "./demand.js";
import type { EAssignment, EContext, ERule, EShift, EStaff, Evaluator, Finding } from "./types.js";
import { DAY_MIN, hm, hoursOf, interval, sayDay, sayRange, weekdayOf } from "./time.js";

interface Index {
  shiftById: Map<string, EShift>;
  staffById: Map<string, EStaff>;
  /** Duty assignments only (Off Duty is not a duty), per person, by day. */
  duties: Map<string, Map<number, EAssignment[]>>;
}

const cache = new WeakMap<EContext, Index>();

function indexOf(ctx: EContext): Index {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const shiftById = new Map(ctx.shifts.map((s) => [s.id, s]));
  const staffById = new Map(ctx.staff.map((s) => [s.id, s]));
  const duties = new Map<string, Map<number, EAssignment[]>>();
  for (const a of ctx.assignments) {
    if (!shiftById.get(a.shiftId)?.countsAsDuty) continue;
    const perDay = duties.get(a.staffId) ?? new Map<number, EAssignment[]>();
    perDay.set(a.day, [...(perDay.get(a.day) ?? []), a]);
    duties.set(a.staffId, perDay);
  }
  const built = { shiftById, staffById, duties };
  cache.set(ctx, built);
  return built;
}

const inPeriod = (ctx: EContext, day: number) => day >= ctx.period.startDay && day <= ctx.period.endDay;
const clock = (m: number) => `${String(Math.floor((m % DAY_MIN) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function finding(rule: ERule, staff: EStaff | null, day: number | null, message: string, detail?: Record<string, unknown>): Finding {
  return { ruleCode: rule.code, severity: rule.severity, staffId: staff?.id ?? null, day, message, detail };
}

/** A person's duties in time order, with the shift attached. */
function timeline(ix: Index, staffId: string) {
  const out: { day: number; shift: EShift; start: number; end: number }[] = [];
  for (const [day, list] of ix.duties.get(staffId) ?? []) {
    for (const a of list) {
      const shift = ix.shiftById.get(a.shiftId)!;
      out.push({ day, shift, ...interval(day, shift) });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.shift.code.localeCompare(b.shift.code));
}

/** Groups sorted day numbers into runs of consecutive days. */
function runsOf(days: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const d of [...days].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else if (!last || d > last[1]) runs.push([d, d]);
  }
  return runs;
}

// ---------------------------------------------------------------- C1

/**
 * More than the daily limit in separate duties on one day (for example a
 * morning and an afternoon back to back). A single long shift is not
 * flagged here: how long a shift is, is set when the shift is configured,
 * and the weekly rules catch what it adds up to.
 */
export const evaluateDailyHours: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const limit = rule.threshold ?? 8;
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    for (const [day, list] of ix.duties.get(staff.id) ?? []) {
      if (!inPeriod(ctx, day) || list.length < 2) continue;
      const shifts = list.map((a) => ix.shiftById.get(a.shiftId)!);
      const hours = shifts.reduce((n, s) => n + hoursOf(s), 0);
      if (hours > limit) {
        out.push(
          finding(rule, staff, day, `${staff.name} — ${hours} hours of duty on ${sayDay(day)} (${shifts.map((s) => s.code).join(" and ")}), more than the ${limit} hours allowed in a day.`, { hours })
        );
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- C2 and C4: hours over a window

function windowFindings(rule: ERule, ctx: EContext, span: number, limitPerWeek: number, say: (name: string, from: number, to: number, hours: number) => string): Finding[] {
  const ix = indexOf(ctx);
  const out: Finding[] = [];
  const weeks = span / 7;
  for (const staff of ctx.staff) {
    const perDay = ix.duties.get(staff.id);
    if (!perDay) continue;
    const hoursOn = (d: number) => (perDay.get(d) ?? []).reduce((n, a) => n + hoursOf(ix.shiftById.get(a.shiftId)!), 0);
    const breaching: { start: number; hours: number }[] = [];
    for (let w = ctx.period.startDay - (span - 1); w + span - 1 <= ctx.period.endDay; w++) {
      let hours = 0;
      for (let d = w; d < w + span; d++) hours += hoursOn(d);
      if (hours / weeks > limitPerWeek) breaching.push({ start: w, hours });
    }
    // Consecutive breaching windows are one episode.
    let i = 0;
    while (i < breaching.length) {
      let j = i;
      while (j + 1 < breaching.length && breaching[j + 1].start === breaching[j].start + 1) j++;
      const worst = breaching.slice(i, j + 1).reduce((a, b) => (b.hours > a.hours ? b : a));
      const from = breaching[i].start;
      const to = breaching[j].start + span - 1;
      out.push(finding(rule, staff, Math.max(from, ctx.period.startDay), say(staff.name, worst.start, worst.start + span - 1, worst.hours), { hours: worst.hours, from, to }));
      i = j + 1;
    }
  }
  return out;
}

export const evaluateWeeklyHours: Evaluator = (rule, ctx) => {
  const limit = rule.threshold ?? 40;
  return windowFindings(rule, ctx, 7, limit, (name, a, b, hours) => `${name} — ${hours} hours of duty in the seven days ${sayRange(a, b)}, more than the ${limit} hours allowed in a week.`);
};

export const evaluateReferencePeriodAverage: Evaluator = (rule, ctx) => {
  const limit = rule.threshold ?? 40;
  const weeks = ctx.referenceWeeks;
  return windowFindings(
    rule,
    ctx,
    weeks * 7,
    limit,
    (name, a, b, hours) => `${name} — ${Math.round((hours / weeks) * 10) / 10} hours a week on average over the ${weeks} weeks ${sayRange(a, b)}, more than the ${limit} allowed.`
  );
};

// ---------------------------------------------------------------- C3

export const evaluateWeeklyConsecutiveRest: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const needed = (rule.threshold ?? 48) * 60;
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    const duties = timeline(ix, staff.id);
    if (!duties.length) continue;
    for (let ws = ctx.period.startDay - 6; ws + 6 <= ctx.period.endDay; ws++) {
      if (weekdayOf(ws) !== ctx.weekStartsOn) continue;
      const from = ws * DAY_MIN;
      const to = (ws + 7) * DAY_MIN;
      const inWeek = duties.filter((d) => d.end > from && d.start < to);
      if (!inWeek.length) continue;
      let cursor = from;
      let longest = 0;
      for (const d of inWeek) {
        longest = Math.max(longest, Math.max(0, Math.min(d.start, to) - cursor));
        cursor = Math.max(cursor, Math.min(d.end, to));
      }
      longest = Math.max(longest, to - cursor);
      if (longest < needed) {
        out.push(
          finding(
            rule,
            staff,
            Math.max(ws, ctx.period.startDay),
            `${staff.name} — no unbroken ${rule.threshold ?? 48}-hour rest in the week ${sayRange(ws, ws + 6)}; the longest is ${hm(longest)} hours. Weekly rest entitlement not met.`,
            { longestRestMinutes: longest }
          )
        );
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- C5 and C6: the gap between two shifts

function gaps(rule: ERule, ctx: EContext, wantImpossible: boolean): Finding[] {
  const ix = indexOf(ctx);
  const needed = (rule.threshold ?? 11) * 60;
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    const t = timeline(ix, staff.id);
    for (let i = 1; i < t.length; i++) {
      const p = t[i - 1];
      const n = t[i];
      if (!inPeriod(ctx, n.day)) continue;
      const gap = n.start - p.end;
      const impossible = gap < 0 || (gap === 0 && p.shift.isOvernight);
      if (wantImpossible && impossible) {
        out.push(
          finding(
            rule,
            staff,
            n.day,
            `${staff.name} — ${n.shift.code} on ${sayDay(n.day)} starts at ${clock(n.start)}, but ${p.shift.code} on ${sayDay(p.day)} runs until ${clock(p.end)}. Both cannot be worked.`,
            { previousDay: p.day, gapMinutes: gap }
          )
        );
      } else if (!wantImpossible && !impossible && gap < needed) {
        out.push(
          finding(
            rule,
            staff,
            n.day,
            `${staff.name} — only ${hm(gap)} hours of rest between ${p.shift.code} on ${sayDay(p.day)} and ${n.shift.code} on ${sayDay(n.day)}. At least ${rule.threshold ?? 11} hours are required.`,
            { previousDay: p.day, gapMinutes: gap }
          )
        );
      }
    }
  }
  return out;
}

export const evaluateInterShiftRest: Evaluator = (rule, ctx) => gaps(rule, ctx, false);
export const evaluateImpossibleSequence: Evaluator = (rule, ctx) => gaps(rule, ctx, true);

// ---------------------------------------------------------------- C7 and C8: runs

export const evaluateConsecutiveDutyDays: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const limit = rule.threshold ?? 6;
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    for (const [a, b] of runsOf([...(ix.duties.get(staff.id)?.keys() ?? [])])) {
      const length = b - a + 1;
      if (length > limit && b >= ctx.period.startDay && a <= ctx.period.endDay) {
        out.push(finding(rule, staff, Math.max(a, ctx.period.startDay), `${staff.name} — ${length} consecutive duty days, ${sayRange(a, b)}. More than ${limit} in a row.`, { length }));
      }
    }
  }
  return out;
};

export const evaluateConsecutiveNights: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const limit = rule.threshold ?? 3;
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    const nights: number[] = [];
    for (const [day, list] of ix.duties.get(staff.id) ?? []) if (list.some((a) => ix.shiftById.get(a.shiftId)!.isOvernight)) nights.push(day);
    for (const [a, b] of runsOf(nights)) {
      const length = b - a + 1;
      if (length > limit && b >= ctx.period.startDay && a <= ctx.period.endDay) {
        out.push(finding(rule, staff, Math.max(a, ctx.period.startDay), `${staff.name} — ${length} consecutive night duties, ${sayRange(a, b)}. More than ${limit} in a row.`, { length }));
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- C9, C10, C11

export const evaluateLeaveCollision: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    const leave = ctx.leave.filter((l) => l.staffId === staff.id);
    if (!leave.length) continue;
    for (const [day, list] of ix.duties.get(staff.id) ?? []) {
      if (!inPeriod(ctx, day)) continue;
      if (leave.some((l) => day >= l.startDay && day <= l.endDay)) {
        const code = ix.shiftById.get(list[0].shiftId)!.code;
        out.push(finding(rule, staff, day, `${staff.name} — rostered for ${code} on ${sayDay(day)}, which is a day of approved leave.`));
      }
    }
  }
  return out;
};

/** Why a person cannot work a shift, or null if they can. Shared with the generator. */
export function ineligibleReason(staff: EStaff, shift: EShift): string | null {
  if (shift.eligibleCadreIds.length && (!staff.cadreId || !shift.eligibleCadreIds.includes(staff.cadreId))) return `their cadre is not on the list for ${shift.name}`;
  if (staff.eligibleShiftIds.length && !staff.eligibleShiftIds.includes(shift.id)) return `${shift.name} is not on their own list of shifts`;
  if (staff.excludedFromNights && shift.isOvernight) return "they are excluded from night duty";
  return null;
}

export const evaluateEligibility: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const out: Finding[] = [];
  for (const staff of ctx.staff) {
    for (const [day, list] of ix.duties.get(staff.id) ?? []) {
      if (!inPeriod(ctx, day)) continue;
      for (const a of list) {
        const shift = ix.shiftById.get(a.shiftId)!;
        const why = ineligibleReason(staff, shift);
        if (why) out.push(finding(rule, staff, day, `${staff.name} — rostered for ${shift.code} on ${sayDay(day)}, but ${why}.`));
      }
    }
  }
  return out;
};

export const evaluateMinimumStaffing: Evaluator = (rule, ctx) => {
  const ix = indexOf(ctx);
  const out: Finding[] = [];
  const duty = ctx.shifts.filter((s) => s.countsAsDuty && !s.isOnCall && hasDemand(s));
  const holidays = new Set(ctx.holidays ?? []);
  for (let day = ctx.period.startDay; day <= ctx.period.endDay; day++) {
    for (const base of duty) {
      const need = demandOn(base, day, holidays);
      const shift = { ...base, minStaff: need.minStaff, minByCadre: need.minByCadre };
      const present: EStaff[] = [];
      for (const s of ctx.staff) if ((ix.duties.get(s.id)?.get(day) ?? []).some((a) => a.shiftId === shift.id)) present.push(s);
      if (present.length < shift.minStaff) {
        out.push(finding(rule, null, day, `${shift.name} on ${sayDay(day)} has ${present.length} of the ${shift.minStaff} people it needs.`, { shiftId: shift.id, required: shift.minStaff, assigned: present.length }));
      }
      for (const [cadreId, need] of Object.entries(shift.minByCadre)) {
        const have = present.filter((s) => s.cadreId === cadreId).length;
        if (have < need) {
          const label = ctx.cadreNames?.[cadreId] ?? "the required cadre";
          out.push(finding(rule, null, day, `${shift.name} on ${sayDay(day)} has ${have} of the ${need} it needs from ${label}.`, { shiftId: shift.id, cadreId, required: need, assigned: have }));
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- the registry

export const RULE_EVALUATORS: Record<string, Evaluator> = {
  C1: evaluateDailyHours,
  C2: evaluateWeeklyHours,
  C3: evaluateWeeklyConsecutiveRest,
  C4: evaluateReferencePeriodAverage,
  C5: evaluateInterShiftRest,
  C6: evaluateImpossibleSequence,
  C7: evaluateConsecutiveDutyDays,
  C8: evaluateConsecutiveNights,
  C9: evaluateLeaveCollision,
  C10: evaluateEligibility,
  C11: evaluateMinimumStaffing,
  // C12 spreads night duties while the roster is generated. It is not a finding.
};

const order = (code: string) => Number(code.slice(1));

/** Runs every enabled rule that has an evaluator and returns what they found, in a stable order. */
export function evaluateCompliance(rules: ERule[], ctx: EContext): Finding[] {
  const all: Finding[] = [];
  for (const rule of rules) {
    const run = RULE_EVALUATORS[rule.code];
    if (run) all.push(...run(rule, ctx));
  }
  return all.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "BLOCK" ? -1 : 1) ||
      (a.day ?? 1e9) - (b.day ?? 1e9) ||
      order(a.ruleCode) - order(b.ruleCode) ||
      (a.staffId ?? "").localeCompare(b.staffId ?? "")
  );
}
