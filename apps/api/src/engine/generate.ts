// The generation engine (spec 1.5). Pure and deterministic: the same inputs
// always give the same roster, because ties break on staff number and the
// local search uses a seeded generator.
//
// One deliberate difference from the spec's wording: slots are filled day by
// day, hardest slots first within each day, rather than hardest first across
// the whole month. Duty cycle runs only make sense in date order, so the
// month is walked forwards and scarcity decides the order inside each day.
import type { EAssignment, ECycleRule, ELeave, EContext, ERotation, ERule, EShift, EStaff, Finding, Period } from "./types.js";
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
  /** The order shifts follow one another, per cadre and department. Optional. */
  rotations?: ERotation[];
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
  /**
   * Duties to add to (positive, they owe) or take off (negative, they are owed)
   * a person's share this month, from the duty ledger. Already clamped.
   */
  settlement?: Record<string, number>;
  /**
   * 0 keeps the plain order. Any other number breaks near-ties differently, so
   * generating again gives another lawful roster built from the same rules.
   */
  variation?: number;
  /**
   * Fill what can be filled and report the rest as unfilled, instead of
   * refusing when a day does not have enough people. Used to refill the
   * duties of someone who has gone on leave, when everything else stays put.
   */
  partial?: boolean;
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
  stats: { duties: number; unfilled: number; improvements: number; carried: number };
}

const LOOKBACK = 14;
/** Pull towards the people with the fewest nights this month. */
const NIGHT_BALANCE = 3;
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
/**
 * Starting a new block of the same kind (nights after nights, days after days) as the last one.
 * Applies only to people who have both a night rule and a day rule, so their month is a blend.
 * It stays below REST_BROKEN and above the night balance's pull, so it steers without breaking a rest.
 */
const SAME_KIND_BLOCK = 9;
/** Each duty still owed to or from the ledger moves a person this far up or down the queue. */
const LEDGER_WEIGHT = 5;
/** Rotation order is a weak preference beside fairness: 2 either way against the ledger's 5 and a night's 10 (spec 2A.3). */
const ROTATION_WEIGHT = 2;
const CARRY_SPECIAL_WEIGHT = 1.5;
/** Each duty a person is behind their cadre's pace this month moves them this far up the queue (spec phase 3, deficit). */
const DEFICIT_WEIGHT = 6;
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
  /** The last duty worked: which day, and whether it was a night. Survives days off, so the next block knows what came before. */
  last?: { day: number; night: boolean };
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
  // Blend: a block that starts after days off should not be the same kind as the block before it.
  if (st.last && st.last.day < day - 1 && st.last.night === shift.isOvernight && rules.some((r) => r.night === true) && rules.some((r) => r.night === false)) {
    soft += SAME_KIND_BLOCK;
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
  st.last = { day, night: shift.isOvernight };
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
  if (staff.morningOnly) return []; // in-charges are outside the duty cycles
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
  // A rule is a night rule when every shift it counts is overnight, otherwise a day rule.
  const kinded: ECycleRule[] = input.cycles.map((r) => {
    const counted = r.countingShiftIds.map((id) => shiftById.get(id)).filter((x): x is EShift => !!x);
    return { ...r, night: counted.length > 0 && counted.every((x) => x.isOvernight) };
  });
  const cycleRules = new Map(staff.map((s) => [s.id, rulesFor(s, kinded)]));
  const state = new Map<string, RunState>();
  for (const s of staff) {
    const st = freshState();
    for (let d = period.startDay - LOOKBACK; d < period.startDay; d++) {
      const sid = dutyOn(s.id, d);
      advance(st, cycleRules.get(s.id)!, d, sid ? shiftById.get(sid)! : null);
    }
    state.set(s.id, st);
  }

  // ---- In-charges: the morning shift on every weekday they are not on leave, before anyone else is placed
  const fixed: GeneratedCell[] = [];
  for (const s of staff) {
    const morningId = s.morningOnly ? s.eligibleShiftIds[0] : undefined;
    if (!morningId) continue;
    for (let day = period.startDay; day <= period.endDay; day++) {
      if (weekdayOf(day) === 0 || weekdayOf(day) === 6 || holidays.has(day) || onLeave(s, day) || by.get(s.id)!.has(day)) continue;
      by.get(s.id)!.set(day, morningId);
      fixed.push({ staffId: s.id, shiftId: morningId, day, source: "GENERATED" });
    }
  }

  // ---- Step 2 and 3: who could work what, and whether it can be done at all
  // A day someone has been deliberately kept off is not offered to them.
  const keptOff = new Set(input.locked.filter((l) => shiftById.get(l.shiftId) && !shiftById.get(l.shiftId)!.countsAsDuty).map((l) => `${l.staffId}:${l.day}`));
  const staticReason = (s: EStaff, shift: EShift, day: number): string | null => {
    if (onLeave(s, day)) return "leave";
    if (keptOff.has(`${s.id}:${day}`)) return "kept off duty";
    if (s.morningOnly && (weekdayOf(day) === 0 || weekdayOf(day) === 6 || holidays.has(day))) return "in-charges work weekday mornings only";
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
  if (preflight.length && !input.partial) {
    return { feasible: false, shortfalls: preflight, cells: [], unfilled: [], findings: [], stats: { duties: 0, unfilled: 0, improvements: 0, carried: 0 } };
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

  // ---- Carry-over from the last three months (spec Part 4, phase 2): who has
  // already done more or fewer duties, and more or fewer weekends, than their
  // cadre. Only people with history count, so a new starter is not pulled up.
  const rotationOf = new Map<string, ERotation | null>();
  for (const s of staff) {
    rotationOf.set(
      s.id,
      (input.rotations ?? []).find(
        (r) =>
          r.sequenceShiftIds.length > 1 &&
          (!r.cadreIds.length || (s.cadreId && r.cadreIds.includes(s.cadreId))) &&
          (!r.departmentIds.length || (s.departmentId && r.departmentIds.includes(s.departmentId)))
      ) ?? null
    );
  }
  const carryTotal: Record<string, number> = {};
  const carrySpecial: Record<string, number> = {};
  {
    const hist = new Map<string, { total: number; special: number }>();
    for (const a of input.history) {
      if (!staffById.has(a.staffId) || !shiftById.get(a.shiftId)?.countsAsDuty || a.day >= period.startDay || a.day < period.startDay - 90) continue;
      const h = hist.get(a.staffId) ?? { total: 0, special: 0 };
      h.total++;
      if (weekdayOf(a.day) === 0 || weekdayOf(a.day) === 6) h.special++;
      hist.set(a.staffId, h);
    }
    const cadres = new Set(staff.map((s) => s.cadreId));
    for (const c of cadres) {
      const group = staff.filter((s) => s.cadreId === c && !s.morningOnly && hist.has(s.id));
      if (group.length < 2) continue;
      const meanTotal = group.reduce((n, s) => n + hist.get(s.id)!.total, 0) / group.length;
      const meanSpecial = group.reduce((n, s) => n + hist.get(s.id)!.special, 0) / group.length;
      for (const s of group) {
        carryTotal[s.id] = Math.round(meanTotal - hist.get(s.id)!.total);
        carrySpecial[s.id] = Math.round(hist.get(s.id)!.special - meanSpecial);
      }
    }
  }

  /** What the rotation order says about this person taking this shift today. */
  const rotationCheck = (s: EStaff, shift: EShift, day: number): { hard: number; soft: number } => {
    const rot = rotationOf.get(s.id);
    if (!rot) return { hard: 0, soft: 0 };
    const seq = rot.sequenceShiftIds;
    const to = seq.indexOf(shift.id);
    if (to < 0) return { hard: 0, soft: 0 };
    const mine = by.get(s.id)!;
    let lastDay = -1;
    for (let d = day - 1; d >= day - LOOKBACK; d--) {
      if (mine.has(d)) {
        lastDay = d;
        break;
      }
    }
    if (lastDay < 0) return { hard: 0, soft: 0 };
    const from = seq.indexOf(mine.get(lastDay)!);
    if (from < 0) return { hard: 0, soft: 0 };
    const dist = (to - from + seq.length) % seq.length;
    if (dist === 1) return { hard: 0, soft: -ROTATION_WEIGHT };
    // Moving within a run (a day block that alternates) is the cycle rule's business; the order matters coming back from a rest.
    if (dist >= 2 && lastDay < day - 1) return rot.enforcement === "BLOCK" ? { hard: 1, soft: 0 } : { hard: 0, soft: ROTATION_WEIGHT };
    return { hard: 0, soft: 0 };
  };

  /**
   * Phase 3, assignment by deficit: this month's pace for the cadre is the duties
   * given so far divided by the days people were available; someone below
   * their share (allowing for their own leave) is chosen sooner.
   */
  const deficitPull = (s: EStaff, day: number): number => {
    if (day === period.startDay) return 0;
    const peers = staff.filter((p) => p.cadreId === s.cadreId && !p.morningOnly);
    let given = 0;
    let available = 0;
    const mineAvail = (p: EStaff) => {
      let n = 0;
      for (let d = period.startDay; d < day; d++) if (!onLeave(p, d)) n++;
      return n;
    };
    for (const p of peers) {
      given += dutyCount(p.id, period.startDay, day - 1, () => true);
      available += mineAvail(p);
    }
    if (available === 0) return 0;
    // Duties owed through the ledger, or carried from earlier months, move a person's share up or down.
    const expected = (given / available) * mineAvail(s) + (input.settlement?.[s.id] ?? 0) + (carryTotal[s.id] ?? 0);
    const behind = expected - dutyCount(s.id, period.startDay, day - 1, () => true);
    return -DEFICIT_WEIGHT * Math.max(-4, Math.min(4, behind));
  };

  /** Weekend duties already done in the last three months, against the cadre: more than the others means later in the queue. */
  const carryPull = (s: EStaff): number => CARRY_SPECIAL_WEIGHT * Math.max(-4, Math.min(4, carrySpecial[s.id] ?? 0));

  const nightWeight = rule.has("C12") ? 10 * (limit("C12") ?? 1) : 10;
  const knownFrom = Math.min(period.startDay, ...input.history.map((h) => h.day));
  const dutyCount = (id: string, from: number, to: number, test: (sh: EShift, d: number) => boolean) => {
    let n = 0;
    for (const [d, sid] of by.get(id)!) if (d >= from && d <= to && test(shiftById.get(sid)!, d)) n++;
    return n;
  };

  /**
   * Nights are shared in blocks, so the people with the fewest nights this
   * month start the next block. A person part-way through a block is held there
   * by the cycle reward, not by this.
   */
  const monthNights = new Map<string, number>();
  for (const s of staff) monthNights.set(s.id, dutyCount(s.id, period.startDay, period.endDay, (sh) => sh.isOvernight));
  const nightTakers = (cadreId: string | null) => staff.filter((p) => p.cadreId === cadreId && !p.excludedFromNights && !p.morningOnly);
  const nightBalance = (s: EStaff, shift: EShift): number => {
    if (!shift.isOvernight) return 0;
    const group = nightTakers(s.cadreId);
    if (group.length < 2) return 0;
    const mean = group.reduce((n, p) => n + (monthNights.get(p.id) ?? 0), 0) / group.length;
    return NIGHT_BALANCE * Math.max(-8, Math.min(8, (monthNights.get(s.id) ?? 0) - mean));
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
    return nightWeight * (nights / elapsed) + nightBalance(s, shift) + 6 * streak + 4 * special + 2 * (hours / 40) - BLOCK_REWARD * run + ledgerPull(s, day) + carryPull(s) + deficitPull(s, day);
  };

  /**
   * A person who owes duties is chosen sooner until they are that many duties
   * ahead of their cadre's average so far this month; a person who is owed
   * is chosen later until they are that far behind. The pull is capped so the
   * ledger can tilt a month but never override the hard rules.
   */
  const ledgerPull = (s: EStaff, day: number): number => {
    const owed = input.settlement?.[s.id] ?? 0;
    if (owed === 0) return 0;
    const peers = staff.filter((p) => p.cadreId === s.cadreId && !p.morningOnly);
    const count = (id: string) => dutyCount(id, period.startDay, day - 1, () => true);
    const average = peers.reduce((n, p) => n + count(p.id), 0) / Math.max(1, peers.length);
    const remaining = owed - (count(s.id) - average);
    return -LEDGER_WEIGHT * Math.max(-3, Math.min(3, remaining));
  };

  const generated: GeneratedCell[] = [];
  const unfilled: Shortfall[] = [];
  const variation = input.variation ?? 0;
  const jitterRandom = mulberry32(period.startDay * 31 + variation);
  // Under one point, so it only reorders staff whose costs are otherwise level.
  const jitter = () => (variation ? jitterRandom() * 0.9 : 0);
  for (let day = period.startDay; day <= period.endDay; day++) {
    for (const slot of daySlots.get(day)!) {
      let best: { s: EStaff; score: number } | null = null;
      for (const s of staff) {
        if (slot.cadreId && s.cadreId !== slot.cadreId) continue;
        if (hardReason(s, slot.shift, day)) continue;
        const check = dutyCheck(state.get(s.id)!, cycleRules.get(s.id)!, day, slot.shift);
        if (check.hard) continue;
        const rot = rotationCheck(s, slot.shift, day);
        if (rot.hard) continue;
        const sc = score(s, slot.shift, day) + check.soft + rot.soft + jitter();
        if (!best || sc < best.score) best = { s, score: sc }; // staff are already in staff-number order, so ties keep the earlier number
      }
      if (best) {
        by.get(best.s.id)!.set(day, slot.shift.id);
        if (slot.shift.isOvernight) monthNights.set(best.s.id, (monthNights.get(best.s.id) ?? 0) + 1);
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
        const rc = rotationCheck(s, shift, d);
        hard += rc.hard;
        soft += rc.soft;
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
  const random = mulberry32(period.startDay + (input.variation ?? 0) * 7919);
  let improvements = 0;

  // ---- Step 4b: close gaps by moving duties along a short chain
  // The greedy pass works forwards one day at a time, so it can bunch a cadre's
  // hours into the same week and find nobody left on the day that needs them,
  // while the same people are idle days later. For each gap, look for someone of
  // the right cadre who would be free if one nearby duty of theirs moved to a
  // colleague of the same cadre, who may in turn hand one on (at most two
  // hand-overs). Nothing is accepted that makes anyone's rules worse than
  // before. The search is cut off by a count of tries, not by the clock, so
  // the same inputs still give the same roster.
  let tries = 0;
  const TRY_BUDGET = 12000;
  const place = (c: EStaff, day: number, shift: EShift, depth: number, chain: Set<string>): boolean => {
    if (tries++ > TRY_BUDGET) return false;
    const mine = by.get(c.id)!;
    if (c.morningOnly || mine.has(day) || staticReason(c, shift, day)) return false;
    const vBefore = violations(c);
    if (!hardReason(c, shift, day)) {
      mine.set(day, shift.id);
      if (violations(c) <= vBefore) return true;
      mine.delete(day);
    }
    if (depth === 0) return false;
    const near = generated
      .filter((g) => g.staffId === c.id && g.day !== day && Math.abs(g.day - day) <= 6 && !lockedKeys.has(`${c.id}:${g.day}`))
      .sort((x, y) => Math.abs(x.day - day) - Math.abs(y.day - day) || x.day - y.day);
    for (const move of near) {
      const moved = shiftById.get(move.shiftId)!;
      mine.delete(move.day);
      if (hardReason(c, shift, day)) {
        mine.set(move.day, move.shiftId);
        continue;
      }
      mine.set(day, shift.id);
      if (violations(c) > vBefore) {
        mine.delete(day);
        mine.set(move.day, move.shiftId);
        continue;
      }
      // c now holds its final state while the hand-over is looked for, and nobody already in the chain is asked again.
      const takers = staff
        .filter((r) => !chain.has(r.id) && r.id !== c.id && r.cadreId === c.cadreId && !r.morningOnly && !lockedKeys.has(`${r.id}:${move.day}`))
        .sort((x, y) => dutyCount(x.id, period.startDay, period.endDay, () => true) - dutyCount(y.id, period.startDay, period.endDay, () => true) || x.staffNo.localeCompare(y.staffNo, undefined, { numeric: true }));
      for (const r of takers) {
        if (by.get(r.id)!.has(move.day)) continue;
        if (place(r, move.day, moved, depth - 1, new Set([...chain, c.id]))) {
          move.staffId = r.id;
          return true;
        }
      }
      mine.delete(day);
      mine.set(move.day, move.shiftId);
    }
    return false;
  };
  for (let pass = 0; pass < 2 && unfilled.length; pass++) {
    for (const gap of [...unfilled]) {
      if (!gap.shiftId) continue;
      const shift = shiftById.get(gap.shiftId)!;
      const candidates = staff.filter((c) => !gap.cadreId || c.cadreId === gap.cadreId);
      for (const c of candidates) {
        if (place(c, gap.day, shift, 3, new Set())) {
          generated.push({ staffId: c.id, shiftId: shift.id, day: gap.day, source: "GENERATED" });
          unfilled.splice(unfilled.indexOf(gap), 1);
          break;
        }
      }
    }
  }

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

  // ---- Step 5b: hand a duty from someone with two or more above a colleague to that colleague
  if (generated.length > 1) {
    const total = (id: string) => dutyCount(id, period.startDay, period.endDay, () => true);
    for (let i = 0; i < 400; i++) {
      const a = generated[Math.floor(random() * generated.length)];
      const from = staffById.get(a.staffId)!;
      const peers = staff.filter((p) => p.cadreId === from.cadreId && p.id !== from.id && !p.morningOnly && total(p.id) <= total(from.id) - 2);
      if (!peers.length) continue;
      const to = peers[Math.floor(random() * peers.length)];
      const shift = shiftById.get(a.shiftId)!;
      if (staticReason(to, shift, a.day) || by.get(to.id)!.has(a.day) || lockedKeys.has(`${from.id}:${a.day}`)) continue;
      const before = cost(from) + cost(to);
      const vBefore = violations(from) + violations(to);
      by.get(from.id)!.delete(a.day);
      by.get(to.id)!.set(a.day, a.shiftId);
      if (cost(from) + cost(to) < before && violations(from) + violations(to) <= vBefore) {
        a.staffId = to.id;
        improvements++;
      } else {
        by.get(to.id)!.delete(a.day);
        by.get(from.id)!.set(a.day, a.shiftId);
      }
    }
  }

  // ---- Step 6: every blank cell becomes Off Duty, and rest blocks are marked
  const cells: GeneratedCell[] = [...generated, ...fixed].sort((x, y) => x.day - y.day || x.shiftId.localeCompare(y.shiftId) || x.staffId.localeCompare(y.staffId));
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
  return { feasible: true, shortfalls: [], cells, unfilled, findings, stats: { duties: generated.length + fixed.length, unfilled: unfilled.length, improvements, carried: Object.values(carryTotal).filter((n) => n !== 0).length } };
}
