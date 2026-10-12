// The generation engine (spec 1.5). Pure and deterministic: the same inputs
// always give the same roster, because ties break on staff number and the
// local search uses a seeded generator.
//
// One deliberate difference from the spec's wording: slots are filled day by
// day, hardest slots first within each day, rather than hardest first across
// the whole month. Duty cycle runs only make sense in date order, so the
// month is walked forwards and scarcity decides the order inside each day.
import type { EAssignment, ECycleRule, ELeave, EContext, ERule, EShift, EStaff, Finding, Period } from "./types.js";
import { DAY_MIN, interval, hoursOf, weekdayOf } from "./time.js";
import { evaluateCompliance, ineligibleReason, RULE_EVALUATORS } from "./evaluators.js";

export interface GenerateInput {
  staff: EStaff[];
  /** Every shift, including Off Duty. Only duty shifts that are not on call get staffed. */
  shifts: EShift[];
  offShiftId: string | null;
  /** Enabled constraint rules. */
  rules: ERule[];
  cycles: ECycleRule[];
  leave: ELeave[];
  holidays: number[];
  period: Period;
  weekStartsOn: number;
  referenceWeeks: number;
  /** Assignments before the period, up to about 90 days back. */
  history: EAssignment[];
  /** Assignments already in the period that must be kept. */
  locked: EAssignment[];
  cadreNames?: Record<string, string>;
}

export interface Shortfall {
  day: number;
  /** Null when the day as a whole needs more people than exist, whichever shifts they work. */
  shiftId: string | null;
  cadreId: string | null;
  required: number;
  available: number;
}

export interface GeneratedCell {
  staffId: string;
  shiftId: string;
  day: number;
  source: "GENERATED" | "REST_BLOCK";
}

export interface GenerateResult {
  feasible: boolean;
  /** Set when feasible is false: why no roster was built. */
  shortfalls: Shortfall[];
  cells: GeneratedCell[];
  /** Slots the engine could not fill lawfully. */
  unfilled: Shortfall[];
  findings: Finding[];
  stats: { duties: number; unfilled: number; improvements: number };
}

const LOOKBACK = 14;
/**
 * How strongly a run already under way is rewarded. The spec gives 3, but at
 * that weight it is smaller than the 6 charged for each consecutive day
 * already worked, so the engine scatters duties instead of building blocks.
 * It must outweigh that charge for the roster to read as a roster.
 */
const BLOCK_REWARD = 14;
const REST_BROKEN = 50;
/** Coming back from a rest on the wrong shift, and on the right one (spec 2A.3). */
const WRONG_AFTER_REST = 15;
const RIGHT_AFTER_REST = 4;
/** Out of the order a rule sets for its block. The spec says 3; a little more is needed for the order to read clearly. */
const OFF_PATTERN = 8;
const HARD_CODES = ["C2", "C3", "C5", "C6", "C7", "C8"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- duty cycle run state

interface RunState {
  runs: Map<string, number>;
  rest: Map<number, "BLOCK" | "PREFER">;
  /** Set when a rest block starts: what the first duty back must be, and from which day the rest is over. */
  back?: { shiftId: string; enforcement: "BLOCK" | "PREFER"; firedDay: number; restEnds: number };
}

const freshState = (): RunState => ({ runs: new Map(), rest: new Map() });

/** What a duty on this day would cost this person under their cycle rules. hard > 0 means it breaks a rule set to Block. */
function dutyCheck(st: RunState, rules: ECycleRule[], day: number, shift: EShift): { hard: number; soft: number } {
  let hard = 0;
  let soft = 0;
  const rest = st.rest.get(day);
  if (rest === "BLOCK") hard++;
  else if (rest === "PREFER") soft += REST_BROKEN;
  const back = st.back;
  if (back && day > back.restEnds) {
    if (shift.id !== back.shiftId) {
      if (back.enforcement === "BLOCK") hard++;
      else soft += WRONG_AFTER_REST;
    } else {
      soft -= RIGHT_AFTER_REST;
    }
  }
  for (const r of rules) {
    const pattern = r.blockShiftPatternIds ?? [];
    if (!pattern.length || !r.countingShiftIds.includes(shift.id) || !pattern.includes(shift.id)) continue;
    const expected = pattern[(st.runs.get(r.id) ?? 0) % pattern.length];
    if (shift.id !== expected) {
      if (r.enforcement === "BLOCK") hard++;
      else soft += OFF_PATTERN;
    }
    break; // the highest-priority rule that orders this shift decides
  }
  return { hard, soft };
}

/** One day's effect on a person's runs. `shift` is null on an off day. */
function advance(st: RunState, rules: ECycleRule[], day: number, shift: EShift | null) {
  if (!shift || !shift.countsAsDuty) {
    for (const r of rules) st.runs.set(r.id, 0);
    return;
  }
  if (st.back && day > st.back.firedDay) st.back = undefined; // the first duty since the rule fired has now happened
  const fired: ECycleRule[] = [];
  for (const r of rules) {
    if (r.countingShiftIds.includes(shift.id)) {
      const run = (st.runs.get(r.id) ?? 0) + 1;
      st.runs.set(r.id, run);
      if (run >= r.consecutiveDuties) fired.push(r);
    } else {
      st.runs.set(r.id, 0);
    }
  }
  if (fired.length) {
    // The lowest priority number wins, and two off blocks are never stacked.
    const winner = fired[0];
    for (let i = 1; i <= winner.offDaysRequired; i++) {
      if (!st.rest.has(day + i) || winner.enforcement === "BLOCK") st.rest.set(day + i, winner.enforcement);
    }
    for (const r of fired) st.runs.set(r.id, 0);
    st.back = winner.nextShiftAfterRestId
      ? { shiftId: winner.nextShiftAfterRestId, enforcement: winner.enforcement, firedDay: day, restEnds: day + winner.offDaysRequired }
      : undefined;
  }
}

type ByStaff = Map<string, Map<number, string>>;

function rulesFor(staff: EStaff, cycles: ECycleRule[]): ECycleRule[] {
  return cycles
    .filter((r) => (!r.cadreIds.length || (staff.cadreId && r.cadreIds.includes(staff.cadreId))) && (!r.departmentIds.length || (staff.departmentId && r.departmentIds.includes(staff.departmentId))))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the engine

export function generate(input: GenerateInput): GenerateResult {
  const { period } = input;
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const duty = input.shifts.filter((s) => s.countsAsDuty && !s.isOnCall).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const staff = [...input.staff].sort((a, b) => a.staffNo.localeCompare(b.staffNo, undefined, { numeric: true }));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const rule = new Map(input.rules.map((r) => [r.code, r]));
  const holidays = new Set(input.holidays);
  const leaveDays = new Map<string, Set<number>>();
  for (const l of input.leave) {
    const set = leaveDays.get(l.staffId) ?? new Set<number>();
    for (let d = l.startDay; d <= l.endDay; d++) set.add(d);
    leaveDays.set(l.staffId, set);
  }
  const onLeave = (s: EStaff, day: number) => leaveDays.get(s.id)?.has(day) ?? false;

  // What each person is doing on each day, from the past, from locked cells, and as we assign.
  const by: ByStaff = new Map(staff.map((s) => [s.id, new Map<number, string>()]));
  for (const a of [...input.history, ...input.locked]) {
    if (!staffById.has(a.staffId) || !shiftById.get(a.shiftId)?.countsAsDuty) continue;
    by.get(a.staffId)!.set(a.day, a.shiftId);
  }
  const dutyOn = (id: string, day: number) => by.get(id)!.get(day);

  // ---- Step 0: run state carried across the month boundary
  const cycleRules = new Map(staff.map((s) => [s.id, rulesFor(s, input.cycles)]));
  const state = new Map<string, RunState>();
  for (const s of staff) {
    const st = freshState();
    for (let d = period.startDay - LOOKBACK; d < period.startDay; d++) {
      const sid = dutyOn(s.id, d);
      advance(st, cycleRules.get(s.id)!, d, sid ? shiftById.get(sid)! : null);
    }
    state.set(s.id, st);
  }

  // ---- Step 2 and 3: who could work what, and whether it can be done at all
  const staticReason = (s: EStaff, shift: EShift, day: number): string | null => {
    if (onLeave(s, day)) return "leave";
    return ineligibleReason(s, shift);
  };

  interface Slot {
    day: number;
    shift: EShift;
    cadreId: string | null;
    scarcity: number;
    order: number;
  }

  const slotsOf = (day: number): { slots: Slot[]; shortfalls: Shortfall[] } => {
    const slots: Slot[] = [];
    const shortfalls: Shortfall[] = [];
    const idle = staff.filter((s) => !dutyOn(s.id, day) && !onLeave(s, day)).length;
    let needTotal = 0;
    for (const shift of duty) {
      const entries = Object.entries(shift.minByCadre);
      const cadreTotal = entries.reduce((n, [, v]) => n + v, 0);
      const total = Math.max(shift.minStaff, cadreTotal);
      const placed = staff.filter((s) => dutyOn(s.id, day) === shift.id);
      const left = new Map(entries);
      let anyLeft = total - cadreTotal;
      for (const p of placed) {
        const c = p.cadreId && left.get(p.cadreId);
        if (c) left.set(p.cadreId!, c - 1);
        else if (anyLeft > 0) anyLeft--;
      }
      for (const [cadreId, n] of left) {
        if (n <= 0) continue;
        const pool = staff.filter((s) => s.cadreId === cadreId && !dutyOn(s.id, day) && !staticReason(s, shift, day)).length;
        if (pool < n) shortfalls.push({ day, shiftId: shift.id, cadreId, required: n, available: pool });
        for (let i = 0; i < n; i++) slots.push({ day, shift, cadreId, scarcity: pool, order: shift.sortOrder });
        needTotal += n;
      }
      if (anyLeft > 0) {
        const pool = staff.filter((s) => !dutyOn(s.id, day) && !staticReason(s, shift, day)).length;
        if (pool < anyLeft) shortfalls.push({ day, shiftId: shift.id, cadreId: null, required: anyLeft, available: pool });
        for (let i = 0; i < anyLeft; i++) slots.push({ day, shift, cadreId: null, scarcity: pool, order: shift.sortOrder });
        needTotal += anyLeft;
      }
    }
    if (needTotal > idle && !shortfalls.length) {
      // Enough people for each shift on its own, but not for all the shifts at once.
      shortfalls.push({ day, shiftId: null, cadreId: null, required: needTotal, available: idle });
    }
    // Hardest first; then nights, which have the tightest rest limits; cadre slots before open ones; then shift order.
    slots.sort((a, b) => a.scarcity - b.scarcity || Number(b.shift.isOvernight) - Number(a.shift.isOvernight) || (a.cadreId ? 0 : 1) - (b.cadreId ? 0 : 1) || a.order - b.order);
    return { slots, shortfalls };
  };

  const preflight: Shortfall[] = [];
  const daySlots = new Map<number, Slot[]>();
  for (let day = period.startDay; day <= period.endDay; day++) {
    const { slots, shortfalls } = slotsOf(day);
    daySlots.set(day, slots);
    preflight.push(...shortfalls);
  }
  if (preflight.length) {
    return { feasible: false, shortfalls: preflight, cells: [], unfilled: [], findings: [], stats: { duties: 0, unfilled: 0, improvements: 0 } };
  }

  // ---- Step 4: greedy assignment, day by day
  const limit = (code: string) => rule.get(code)?.threshold ?? null;
  const c2 = rule.has("C2") ? limit("C2") ?? 40 : null;
  const c3 = rule.has("C3") ? limit("C3") ?? 48 : null;
  const c5 = rule.has("C5") ? limit("C5") ?? 11 : null;
  const c7 = rule.has("C7") ? limit("C7") ?? 6 : null;
  const c8 = rule.has("C8") ? limit("C8") ?? 3 : null;

  const week = (day: number) => {
    const offset = (weekdayOf(day) - input.weekStartsOn + 7) % 7;
    return day - offset;
  };

  /** Why this person cannot take this shift on this day, given everything assigned so far. */
  const hardReason = (s: EStaff, shift: EShift, day: number): string | null => {
    const mine = by.get(s.id)!;
    if (mine.has(day)) return "already on duty";
    const why = staticReason(s, shift, day);
    if (why) return why;

    const me = interval(day, shift);
    for (let d = day - 2; d <= day + 2; d++) {
      const sid = mine.get(d);
      if (!sid || d === day) continue;
      const other = shiftById.get(sid)!;
      const o = interval(d, other);
      const [first, second] = d < day ? [o, me] : [me, o];
      const firstShift = d < day ? other : shift;
      const gap = second.start - first.end;
      if (gap < 0 || (gap === 0 && firstShift.isOvernight)) return "overlap";
      if (c5 !== null && gap < c5 * 60) return "rest";
    }
    if (c2 !== null) {
      for (let w = day - 6; w <= day; w++) {
        let h = hoursOf(shift);
        for (let d = w; d < w + 7; d++) {
          const sid = mine.get(d);
          if (sid && d !== day) h += hoursOf(shiftById.get(sid)!);
        }
        if (h > c2) return "weekly hours";
      }
    }
    if (s.maxDutiesPerWeek > 0) {
      const ws = week(day);
      let n = 1;
      for (let d = ws; d < ws + 7; d++) if (mine.has(d)) n++;
      if (n > s.maxDutiesPerWeek) return "weekly maximum";
    }
    if (c3 !== null) {
      const ws = week(day);
      const from = ws * DAY_MIN;
      const to = (ws + 7) * DAY_MIN;
      const list: { start: number; end: number }[] = [me];
      for (let d = ws - 1; d <= ws + 6; d++) {
        const sid = mine.get(d);
        if (sid && d !== day) list.push(interval(d, shiftById.get(sid)!));
      }
      list.sort((a, b) => a.start - b.start);
      let cursor = from;
      let longest = 0;
      for (const iv of list) {
        if (iv.end <= from || iv.start >= to) continue;
        longest = Math.max(longest, Math.max(0, Math.min(iv.start, to) - cursor));
        cursor = Math.max(cursor, Math.min(iv.end, to));
      }
      longest = Math.max(longest, to - cursor);
      if (longest < c3 * 60) return "weekly rest";
    }
    const runLength = (test: (id: string) => boolean) => {
      let n = 1;
      for (let d = day - 1; mine.has(d) && test(mine.get(d)!); d--) n++;
      for (let d = day + 1; mine.has(d) && test(mine.get(d)!); d++) n++;
      return n;
    };
    if (c7 !== null && runLength(() => true) > c7) return "consecutive days";
    if (c8 !== null && shift.isOvernight && runLength((id) => shiftById.get(id)!.isOvernight) > c8) return "consecutive nights";
    return null;
  };

  const nightWeight = rule.has("C12") ? 10 * (limit("C12") ?? 1) : 10;
  const knownFrom = Math.min(period.startDay, ...input.history.map((h) => h.day));
  const dutyCount = (id: string, from: number, to: number, test: (sh: EShift, d: number) => boolean) => {
    let n = 0;
    for (const [d, sid] of by.get(id)!) if (d >= from && d <= to && test(shiftById.get(sid)!, d)) n++;
    return n;
  };

  const score = (s: EStaff, shift: EShift, day: number): number => {
    const mine = by.get(s.id)!;
    const elapsed = Math.max(7, Math.min(90, day - knownFrom));
    const nights = dutyCount(s.id, day - 90, day - 1, (sh) => sh.isOvernight);
    let streak = 0;
    for (let d = day - 1; d >= period.startDay && mine.has(d); d--) streak++;
    const special = dutyCount(s.id, period.startDay, day - 1, (_sh, d) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d));
    let hours = 0;
    for (const [d, sid] of mine) if (d >= period.startDay && d < day) hours += hoursOf(shiftById.get(sid)!);
    const st = state.get(s.id)!;
    let run = 0;
    for (const r of cycleRules.get(s.id)!) if (r.countingShiftIds.includes(shift.id)) run = Math.max(run, st.runs.get(r.id) ?? 0);
    return nightWeight * (nights / elapsed) + 6 * streak + 4 * special + 2 * (hours / 40) - BLOCK_REWARD * run;
  };

  const generated: GeneratedCell[] = [];
  const unfilled: Shortfall[] = [];
  for (let day = period.startDay; day <= period.endDay; day++) {
    for (const slot of daySlots.get(day)!) {
      let best: { s: EStaff; score: number } | null = null;
      for (const s of staff) {
        if (slot.cadreId && s.cadreId !== slot.cadreId) continue;
        if (hardReason(s, slot.shift, day)) continue;
        const check = dutyCheck(state.get(s.id)!, cycleRules.get(s.id)!, day, slot.shift);
        if (check.hard) continue;
        const sc = score(s, slot.shift, day) + check.soft;
        if (!best || sc < best.score) best = { s, score: sc }; // staff are already in staff-number order, so ties keep the earlier number
      }
      if (best) {
        by.get(best.s.id)!.set(day, slot.shift.id);
        generated.push({ staffId: best.s.id, shiftId: slot.shift.id, day, source: "GENERATED" });
      } else {
        unfilled.push({ day, shiftId: slot.shift.id, cadreId: slot.cadreId, required: 1, available: 0 });
      }
    }
    for (const s of staff) {
      const sid = dutyOn(s.id, day);
      advance(state.get(s.id)!, cycleRules.get(s.id)!, day, sid ? shiftById.get(sid)! : null);
    }
  }

  // ---- Step 5: local search
  /** Walks a person's month under their cycle rules and totals what breaks. */
  const scan = (s: EStaff): { hard: number; soft: number } => {
    const mine = by.get(s.id)!;
    const st = freshState();
    const rules = cycleRules.get(s.id)!;
    let hard = 0;
    let soft = 0;
    for (let d = period.startDay - LOOKBACK; d <= period.endDay; d++) {
      const sid = mine.get(d);
      const shift = sid ? shiftById.get(sid)! : null;
      if (shift && d >= period.startDay) {
        const c = dutyCheck(st, rules, d, shift);
        hard += c.hard;
        soft += c.soft;
      }
      advance(st, rules, d, shift);
    }
    return { hard, soft };
  };

  const cost = (s: EStaff): number => {
    const mine = by.get(s.id)!;
    let nights = 0;
    let special = 0;
    let hours = 0;
    let pairs = 0;
    for (const [d, sid] of mine) {
      if (d < period.startDay || d > period.endDay) continue;
      const sh = shiftById.get(sid)!;
      if (sh.isOvernight) nights++;
      if (weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d)) special++;
      hours += hoursOf(sh);
      if (mine.has(d + 1)) pairs++;
    }
    const { soft } = scan(s);
    return nightWeight * nights * nights + 4 * special * special + 2 * (hours / 40) * (hours / 40) - BLOCK_REWARD * pairs + soft;
  };

  const violations = (s: EStaff): number => {
    const mine = by.get(s.id)!;
    const list: EAssignment[] = [...mine].map(([day, shiftId]) => ({ staffId: s.id, shiftId, day }));
    const ctx: EContext = { staff: [s], shifts: input.shifts, assignments: list, leave: input.leave.filter((l) => l.staffId === s.id), period, weekStartsOn: input.weekStartsOn, referenceWeeks: input.referenceWeeks };
    let violationsCount = 0;
    let n = 0;
    for (const code of HARD_CODES) {
      const r = rule.get(code);
      if (r) n += RULE_EVALUATORS[code](r, ctx).length;
    }
    if (s.maxDutiesPerWeek > 0) {
      const perWeek = new Map<number, number>();
      for (const [d] of mine) if (d >= period.startDay && d <= period.endDay) perWeek.set(week(d), (perWeek.get(week(d)) ?? 0) + 1);
      for (const n of perWeek.values()) if (n > s.maxDutiesPerWeek) violationsCount++;
    }
    // Off blocks, the shift after a rest, and block orders that are set to Block.
    return n + violationsCount + scan(s).hard;
  };

  const lockedKeys = new Set(input.locked.map((l) => `${l.staffId}:${l.day}`));
  const random = mulberry32(period.startDay);
  let improvements = 0;
  if (generated.length > 1) {
    for (let i = 0; i < 300; i++) {
      const a = generated[Math.floor(random() * generated.length)];
      const b = generated[Math.floor(random() * generated.length)];
      if (a === b || a.staffId === b.staffId) continue;
      const sa = staffById.get(a.staffId)!;
      const sb = staffById.get(b.staffId)!;
      if (sa.cadreId !== sb.cadreId) continue; // keeps each cadre's minimum where it was
      if (a.day === b.day && a.shiftId === b.shiftId) continue;
      const shiftA = shiftById.get(a.shiftId)!;
      const shiftB = shiftById.get(b.shiftId)!;
      if (staticReason(sb, shiftA, a.day) || staticReason(sa, shiftB, b.day)) continue;
      if (by.get(sb.id)!.has(a.day) && !(b.day === a.day && b.staffId === sb.id)) continue;
      if (by.get(sa.id)!.has(b.day) && !(a.day === b.day && a.staffId === sa.id)) continue;
      if (lockedKeys.has(`${sb.id}:${a.day}`) || lockedKeys.has(`${sa.id}:${b.day}`)) continue;

      const before = cost(sa) + cost(sb);
      const vBefore = violations(sa) + violations(sb);
      by.get(sa.id)!.delete(a.day);
      by.get(sb.id)!.delete(b.day);
      by.get(sb.id)!.set(a.day, a.shiftId);
      by.get(sa.id)!.set(b.day, b.shiftId);
      const ok = cost(sa) + cost(sb) < before && violations(sa) + violations(sb) <= vBefore;
      if (ok) {
        a.staffId = sb.id;
        b.staffId = sa.id;
        improvements++;
      } else {
        by.get(sb.id)!.delete(a.day);
        by.get(sa.id)!.delete(b.day);
        by.get(sa.id)!.set(a.day, a.shiftId);
        by.get(sb.id)!.set(b.day, b.shiftId);
      }
    }
  }

  // ---- Step 6: every blank cell becomes Off Duty, and rest blocks are marked
  const cells: GeneratedCell[] = [...generated].sort((x, y) => x.day - y.day || x.shiftId.localeCompare(y.shiftId) || x.staffId.localeCompare(y.staffId));
  if (input.offShiftId) {
    for (const s of staff) {
      const st = freshState();
      const rules = cycleRules.get(s.id)!;
      const mine = by.get(s.id)!;
      for (let d = period.startDay - LOOKBACK; d <= period.endDay; d++) {
        const sid = mine.get(d);
        if (d >= period.startDay && !sid && !input.locked.some((l) => l.staffId === s.id && l.day === d)) {
          cells.push({ staffId: s.id, shiftId: input.offShiftId, day: d, source: st.rest.has(d) ? "REST_BLOCK" : "GENERATED" });
        }
        advance(st, rules, d, sid ? shiftById.get(sid)! : null);
      }
    }
  }

  const assignments: EAssignment[] = [];
  for (const [staffId, days] of by) for (const [day, shiftId] of days) assignments.push({ staffId, shiftId, day });
  const findings = evaluateCompliance(input.rules, {
    staff, shifts: input.shifts, assignments, leave: input.leave, period, weekStartsOn: input.weekStartsOn, referenceWeeks: input.referenceWeeks, cadreNames: input.cadreNames,
  });
  return { feasible: true, shortfalls: [], cells, unfilled, findings, stats: { duties: generated.length, unfilled: unfilled.length, improvements } };
}
