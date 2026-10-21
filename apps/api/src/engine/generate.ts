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
import { demandOn } from "./demand.js";

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
  /**
   * Public-holiday duties each person has worked over the last twelve months.
   * Whoever has worked more of them is kept off this month's holidays first,
   * so over a year everyone gets their share of holidays at home.
   */
  holidayWorked?: Record<string, number>;
  /**
   * Days people asked to have off. Approved ones are kept free like leave;
   * ones still waiting for a decision are avoided where the month allows.
   */
  daysOff?: { staffId: string; day: number; approved: boolean }[];
  /** False builds day by day only, without planning blocks first. For comparison and tests. */
  blocks?: boolean | "only";
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
  stats: { duties: number; unfilled: number; improvements: number; carried: number; /** Stray single days plus night/day flips; lower reads better. */ scatter: number };
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
/** Per holiday worked above the cadre's average over the last year. */
const HOLIDAY_WEIGHT = 5;
/** Working a day someone has asked to have off, while the request waits for a decision. */
const ASKED_OFF = 25;
/** How strongly the day-by-day pass follows the planned blocks. */
const PLAN_FOLLOW = 60;
const PLAN_OTHER_SHIFT = 20;
const PLAN_REST_DAY = 30;
/** A duty with nothing on either side of it. Rosters read as blocks; a stray single day or night is the thing staff dislike most. */
const ISOLATED_DUTY = 16;
const ISOLATED_NIGHT = 32;
/** Moving between a night and a day duty with no rest day between. */
const FLIP = 10;
const HARD_CODES = ["C2", "C3", "C5", "C6", "C7", "C8", "C13", "C14"];

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
  /** This person's rotation. It decides which shift follows a rest; the cycle rule only says how many duties and how many days off. */
  rot?: ERotation | null;
}

const freshState = (rot?: ERotation | null): RunState => ({ runs: new Map(), rest: new Map(), rot: rot ?? null });

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
    // The shift after the rest is the next one in the person's rotation; a rule's own setting is only a fallback for staff with no rotation.
    const seq = st.rot?.sequenceShiftIds ?? [];
    const at = seq.indexOf(shift.id);
    const after = at >= 0 ? seq[(at + 1) % seq.length] : winner.nextShiftAfterRestId;
    st.back = after
      ? { shiftId: after, enforcement: at >= 0 ? st.rot!.enforcement : winner.enforcement, firedDay: day, restEnds: day + winner.offDaysRequired }
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

/**
 * Builds the roster two ways, with planned blocks and with the plain day-by-day
 * pass, and keeps the better: fewest gaps first, then fewest blocking findings,
 * then the least scattered. The plain pass is the safety net for months so tight
 * that no block pattern fits.
 */
export function generate(input: GenerateInput): GenerateResult {
  if (input.blocks === false) return generateOnce(input, false);
  if (input.blocks === "only") return generateOnce(input, true);
  const planned = generateOnce(input, true);
  if (!planned.feasible) return planned;
  const plain = generateOnce(input, false);
  const blocking = (r: GenerateResult) => r.findings.filter((f) => f.severity === "BLOCK").length;
  // A person who owes duties must end up above their cadre's average, and one who is owed below it.
  const ledgerMisses = (r: GenerateResult) => {
    let miss = 0;
    for (const [id, owe] of Object.entries(input.settlement ?? {})) {
      if (!owe) continue;
      const me = input.staff.find((x) => x.id === id);
      if (!me) continue;
      const count = (sid: string) => r.cells.filter((c) => c.staffId === sid && c.shiftId !== input.offShiftId).length;
      const peers = input.staff.filter((x) => x.cadreId === me.cadreId && x.id !== id && !input.settlement?.[x.id]);
      if (!peers.length) continue;
      const avg = peers.reduce((t, x) => t + count(x.id), 0) / peers.length;
      if (owe > 0 ? count(id) < Math.round(avg) + 1 : count(id) > Math.round(avg) - 1) miss++;
    }
    return miss;
  };
  const key = (r: GenerateResult) => [r.unfilled.length, blocking(r), ledgerMisses(r), r.stats.scatter];
  const a = key(planned);
  const b = key(plain);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? planned : plain;
  return planned;
}

function generateOnce(input: GenerateInput, planBlocks: boolean): GenerateResult {
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
  const state = new Map<string, RunState>();
  for (const s of staff) {
    const st = freshState(rotationOf.get(s.id));
    for (let d = period.startDay - LOOKBACK; d < period.startDay; d++) {
      const sid = dutyOn(s.id, d);
      advance(st, cycleRules.get(s.id)!, d, sid ? shiftById.get(sid)! : null);
    }
    state.set(s.id, st);
  }

  // ---- In-charges: the morning shift on every weekday they are not on leave, before anyone else is placed
  const fixed: GeneratedCell[] = [];
  // Days off in the month (C14) on Block caps in-charges too: no morning that would leave fewer days off than it asks for.
  const c14Rule = input.rules.find((r) => r.code === "C14");
  const dutyCap = c14Rule?.severity === "BLOCK" ? period.endDay - period.startDay + 1 - (c14Rule.threshold ?? 8) : Infinity;
  for (const s of staff) {
    const morningId = s.morningOnly ? s.eligibleShiftIds[0] : undefined;
    if (!morningId) continue;
    let worked = [...by.get(s.id)!].filter(([d, sid]) => d >= period.startDay && d <= period.endDay && shiftById.get(sid)!.countsAsDuty).length;
    for (let day = period.startDay; day <= period.endDay; day++) {
      if (worked >= dutyCap) break;
      if (weekdayOf(day) === 0 || weekdayOf(day) === 6 || holidays.has(day) || onLeave(s, day) || by.get(s.id)!.has(day)) continue;
      worked++;
      by.get(s.id)!.set(day, morningId);
      fixed.push({ staffId: s.id, shiftId: morningId, day, source: "GENERATED" });
    }
  }

  // ---- Step 2 and 3: who could work what, and whether it can be done at all
  // A day someone has been deliberately kept off is not offered to them.
  const keptOff = new Set(input.locked.filter((l) => shiftById.get(l.shiftId) && !shiftById.get(l.shiftId)!.countsAsDuty).map((l) => `${l.staffId}:${l.day}`));
  const approvedOff = new Set((input.daysOff ?? []).filter((o) => o.approved).map((o) => `${o.staffId}:${o.day}`));
  const askedOff = new Set((input.daysOff ?? []).filter((o) => !o.approved).map((o) => `${o.staffId}:${o.day}`));
  const staticReason = (s: EStaff, shift: EShift, day: number): string | null => {
    if (onLeave(s, day)) return "leave";
    if (approvedOff.has(`${s.id}:${day}`)) return "day off approved";
    if (shift.isOvernight && s.noNights?.some((p) => day >= p.startDay && day <= p.endDay)) return "no nights for now";
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
    /** Needs someone who can lead the shift. */
    lead?: boolean;
  }

  const slotsOf = (day: number): { slots: Slot[]; shortfalls: Shortfall[] } => {
    const slots: Slot[] = [];
    const shortfalls: Shortfall[] = [];
    const idle = staff.filter((s) => !dutyOn(s.id, day) && !onLeave(s, day)).length;
    let needTotal = 0;
    for (const shift of duty) {
      const need = demandOn(shift, day, holidays);
      const entries = Object.entries(need.minByCadre);
      const cadreTotal = entries.reduce((n, [, v]) => n + v, 0);
      const total = Math.max(need.minStaff, cadreTotal);
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
      // Someone on the shift must be able to lead it: that many of its open places ask for a lead, open places first.
      let leads = (shift.minLeads ?? 0) - placed.filter((p) => p.canLead).length;
      if (leads > 0) {
        const leadPool = staff.filter((s) => s.canLead && !dutyOn(s.id, day) && !staticReason(s, shift, day)).length;
        for (const sl of [...slots].filter((x) => x.shift === shift).sort((a, b) => (a.cadreId ? 1 : 0) - (b.cadreId ? 1 : 0))) {
          if (leads <= 0) break;
          sl.lead = true;
          sl.scarcity = Math.min(sl.scarcity, leadPool);
          leads--;
        }
      }
    }
    if (needTotal > idle && !shortfalls.length) {
      // Enough people for each shift on its own, but not for all the shifts at once.
      shortfalls.push({ day, shiftId: null, cadreId: null, required: needTotal, available: idle });
    }
    // Hardest first; then nights, which have the tightest rest limits; cadre slots before open ones; then shift order.
    // The facility's order for running short comes first: a shift it keeps full is filled before one that may run short.
    slots.sort((a, b) => (b.shift.keepFull ?? 0) - (a.shift.keepFull ?? 0) || Number(b.lead ?? false) - Number(a.lead ?? false) || a.scarcity - b.scarcity || Number(b.shift.isOvernight) - Number(a.shift.isOvernight) || (a.cadreId ? 0 : 1) - (b.cadreId ? 0 : 1) || a.order - b.order);
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
    return { feasible: false, shortfalls: preflight, cells: [], unfilled: [], findings: [], stats: { duties: 0, unfilled: 0, improvements: 0, carried: 0, scatter: 0 } };
  }

  // ---- Step 4: greedy assignment, day by day
  const limit = (code: string) => rule.get(code)?.threshold ?? null;
  const c2 = rule.has("C2") ? limit("C2") ?? 40 : null;
  const c3 = rule.has("C3") ? limit("C3") ?? 48 : null;
  const c5 = rule.has("C5") ? limit("C5") ?? 11 : null;
  const c7 = rule.has("C7") ? limit("C7") ?? 6 : null;
  const c8 = rule.has("C8") ? limit("C8") ?? 3 : null;
  const c13 = rule.has("C13") ? limit("C13") ?? 1 : null;
  const c14 = rule.has("C14") ? limit("C14") ?? 8 : null;
  // Full weekends in the month: each Saturday whose Sunday is also in it.
  const saturdays: number[] = [];
  for (let d = period.startDay; d < period.endDay; d++) if (weekdayOf(d) === 6) saturdays.push(d);
  // A night on the Friday runs into Saturday morning, so that weekend is not free either.
  const weekendFree = (sat: number, dutyOf: (d: number) => string | undefined) => {
    const fri = dutyOf(sat - 1);
    return !dutyOf(sat) && !dutyOf(sat + 1) && !(fri && shiftById.get(fri)?.isOvernight);
  };
  const freeWeekends = (dutyOf: (d: number) => string | undefined) => saturdays.filter((sat) => weekendFree(sat, dutyOf)).length;

  const week = (day: number) => {
    const offset = (weekdayOf(day) - input.weekStartsOn + 7) % 7;
    return day - offset;
  };

  /** Why this person cannot take this shift on this day, given everything assigned so far. */
  // A limit set to Warn does not stop the facility's own duty cycle: a planned block may run past it, and the roster shows the warning.
  const warnOnly = (code: string) => rule.get(code)?.severity !== "BLOCK";
  const hardReason = (s: EStaff, shift: EShift, day: number, planned = false): string | null => {
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
    if (c2 !== null && !(planned && warnOnly("C2"))) {
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
    // Full weekends off (C13) on Block: the duty that would take the last free weekend the person needs is not given.
    if (c13 !== null && !warnOnly("C13")) {
      const sat = weekdayOf(day) === 6 ? day : weekdayOf(day) === 0 ? day - 1 : weekdayOf(day) === 5 && shift.isOvernight ? day + 1 : null;
      const dutyOfNow = (d: number) => mine.get(d);
      if (sat !== null && saturdays.includes(sat) && weekendFree(sat, dutyOfNow) && freeWeekends(dutyOfNow) <= Math.min(c13, saturdays.length)) return "full weekend off";
    }
    // Days off in the month (C14): the duty that would leave fewer than the facility asks for is not given.
    if (c14 !== null && !(planned && warnOnly("C14"))) {
      let n = 1;
      for (const [d, sid] of mine) if (d >= period.startDay && d <= period.endDay && shiftById.get(sid)!.countsAsDuty) n++;
      if (n > period.endDay - period.startDay + 1 - c14) return "days off this month";
    }
    // The person's own limits for the month.
    if (s.maxNightsPerMonth && shift.isOvernight) {
      let n = 1;
      for (const [d, sid] of mine) if (d >= period.startDay && d <= period.endDay && shiftById.get(sid)!.isOvernight) n++;
      if (n > s.maxNightsPerMonth) return "nights this month";
    }
    if (s.maxHoursPerMonth) {
      let h = hoursOf(shift);
      for (const [d, sid] of mine) if (d >= period.startDay && d <= period.endDay) h += hoursOf(shiftById.get(sid)!);
      if (h > s.maxHoursPerMonth) return "hours this month";
    }
    if (c7 !== null && !(planned && warnOnly("C7")) && runLength(() => true) > c7) return "consecutive days";
    if (c8 !== null && !(planned && warnOnly("C8")) && shift.isOvernight && runLength((id) => shiftById.get(id)!.isOvernight) > c8) return "consecutive nights";
    return null;
  };

  // ---- Carry-over from the last three months (spec Part 4, phase 2): who has
  // already done more or fewer duties, and more or fewer weekends, than their
  // cadre. Only people with history count, so a new starter is not pulled up.
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
  const dutyShiftsAll = input.shifts.filter((x) => x.countsAsDuty && !x.isOnCall && x.startMin !== null);
  const avgDutyHours = dutyShiftsAll.length ? dutyShiftsAll.reduce((t, x) => t + hoursOf(x), 0) / dutyShiftsAll.length : 8;
  const peerTotals = new Map<string, { given: number; available: number }>();
  const deficitPull = (s: EStaff, day: number): number => {
    if (day === period.startDay) return 0;
    const mineAvail = (p: EStaff) => {
      let n = 0;
      for (let d = period.startDay; d < day; d++) if (!onLeave(p, d)) n++;
      return n;
    };
    // Counted in hours, so someone who has worked long nights is not also handed the most day duties.
    const hoursSoFar = (id: string) => {
      let h = 0;
      for (const [d, sid] of by.get(id)!) if (d >= period.startDay && d < day) h += hoursOf(shiftById.get(sid)!);
      return h;
    };
    // Only days before `day` count, so the cadre's totals are worked out once per day, not once per candidate.
    const key = `${s.cadreId}|${day}`;
    let totals = peerTotals.get(key);
    if (!totals) {
      totals = { given: 0, available: 0 };
      for (const p of staff) if (p.cadreId === s.cadreId && !p.morningOnly) { totals.given += hoursSoFar(p.id); totals.available += mineAvail(p); }
      peerTotals.set(key, totals);
    }
    const { given, available } = totals;
    if (available === 0) return 0;
    // Duties owed through the ledger, or carried from earlier months, move a person's share up or down.
    const unit = avgDutyHours;
    const expected = ((given / available) * mineAvail(s)) / unit + (input.settlement?.[s.id] ?? 0) + (carryTotal[s.id] ?? 0);
    const behind = expected - hoursSoFar(s.id) / unit;
    return -DEFICIT_WEIGHT * Math.max(-4, Math.min(4, behind));
  };

  // Public holidays: who has worked more of them in the last year, against their cadre.
  const holidayCarry: Record<string, number> = {};
  if (input.holidayWorked) {
    for (const c of new Set(staff.map((s) => s.cadreId))) {
      const group = staff.filter((s) => s.cadreId === c && !s.morningOnly);
      if (group.length < 2) continue;
      const mean = group.reduce((t, s) => t + (input.holidayWorked![s.id] ?? 0), 0) / group.length;
      for (const s of group) holidayCarry[s.id] = Math.max(-4, Math.min(4, (input.holidayWorked[s.id] ?? 0) - mean));
    }
  }
  /** On a public holiday: later in the queue for anyone who has worked more holidays this year, or already one this month. */
  const holidayPull = (s: EStaff, day: number): number => {
    if (!holidays.has(day)) return 0;
    const thisMonth = dutyCount(s.id, period.startDay, period.endDay, (_sh, d) => holidays.has(d));
    return HOLIDAY_WEIGHT * ((holidayCarry[s.id] ?? 0) + 2 * thisMonth);
  };
  /** Following the plan is strongly preferred; working a planned rest day, or another shift than planned, is a last resort. */
  const planPull = (s: EStaff, shift: EShift, day: number): number => {
    const mine = intent.get(s.id);
    if (!mine) return 0;
    const want = mine.get(day);
    if (want === shift.id) return -PLAN_FOLLOW;
    return want ? PLAN_OTHER_SHIFT : PLAN_REST_DAY;
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
    // A full weekend off (C13): working a free weekend of someone who has no more to spare costs a lot.
    let weekendCost = 0;
    const weekendSat = weekdayOf(day) === 6 ? day : weekdayOf(day) === 0 ? day - 1 : weekdayOf(day) === 5 && shift.isOvernight ? day + 1 : null;
    if (c13 !== null && weekendSat !== null) {
      const dutyOfNow = (d: number) => mine.get(d);
      if (saturdays.includes(weekendSat) && weekendFree(weekendSat, dutyOfNow) && freeWeekends(dutyOfNow) <= c13) weekendCost = 40;
    }
    // Shape: join a block that is already there, rather than stand alone or switch kind beside one.
    let shape = 0;
    const before = planBlocks ? mine.get(day - 1) : "";
    const after = planBlocks ? mine.get(day + 1) : "";
    if (planBlocks && !before && !after) shape += shift.isOvernight ? ISOLATED_NIGHT : ISOLATED_DUTY;
    for (const nb of [before, after]) {
      if (!nb) continue;
      const other = shiftById.get(nb);
      if (!other?.countsAsDuty) continue;
      if (other.isOvernight !== shift.isOvernight) shape += FLIP;
      else if (other.id === shift.id) shape -= 4;
    }
    return weekendCost + shape + nightWeight * (nights / elapsed) + nightBalance(s, shift) + 6 * streak + 4 * special + 2 * (hours / 40) - BLOCK_REWARD * run + ledgerPull(s, day) + carryPull(s) + deficitPull(s, day) + holidayPull(s, day) + planPull(s, shift, day);
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
  /** Each person's planned month, day to shift, when blocks are planned. */
  const intent = new Map<string, Map<number, string>>();
  // ---- Step 3b: plan the blocks
  // Staff work in blocks (four nights then three off, four or five days then a
  // day or two off), not in scattered single days. Before any day is filled one
  // by one, each shift's demand is laid out as lanes: one lane for each person a
  // shift needs that day. Each lane is cut into blocks of the cycle's length,
  // with the cut points staggered between lanes so not everyone changes over on
  // the same day. Each block is then given, in date order, to the person it suits
  // best: rested since their last block, not on leave, nights in whole blocks
  // shared evenly, duties at a fair pace, weekends and public holidays shared,
  // the rotation order and the shift after a night rest respected, and each
  // week's unbroken rest kept. The result is everyone's intended month. The
  // day-by-day pass below follows it wherever the rules allow, and fills any
  // block nobody could take.
  if (planBlocks) {
    const days = period.endDay - period.startDay + 1;
    const isSpecial = (d: number) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d);
    const nightsLast90 = (id: string) => dutyCount(id, period.startDay - 90, period.startDay - 1, (sh) => sh.isOvernight);
    const capOf = (r: ECycleRule, night: boolean) =>
      Math.max(1, Math.min(r.consecutiveDuties, warnOnly("C7") ? 99 : c7 ?? 99, night && !warnOnly("C8") ? c8 ?? 99 : 99));
    const ruleFor = (s: EStaff, night: boolean) => cycleRules.get(s.id)!.find((r) => r.night === night && r.offDaysRequired >= 1);

    // The weekly unbroken rest (C3), checked as blocks are given out.
    const weekBroken = (ws: number, dutyOf: (d: number) => string | undefined): boolean => {
      if (c3 === null) return false;
      const from = ws * DAY_MIN;
      const to = (ws + 7) * DAY_MIN;
      const list: { start: number; end: number }[] = [];
      for (let d = ws - 1; d <= ws + 6; d++) {
        const sid = dutyOf(d);
        if (sid && shiftById.get(sid)?.countsAsDuty) list.push(interval(d, shiftById.get(sid)!));
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
      return longest < c3 * 60;
    };

    // Demand per group: a cadre's own slots, or null for slots any cadre may take.
    const demand = new Map<string | null, Map<string, number>>();
    for (let day = period.startDay; day <= period.endDay; day++) {
      for (const slot of daySlots.get(day)!) {
        const g = demand.get(slot.cadreId) ?? new Map<string, number>();
        g.set(`${day}:${slot.shift.id}`, (g.get(`${day}:${slot.shift.id}`) ?? 0) + 1);
        demand.set(slot.cadreId, g);
      }
    }
    const done = new Set<string>();
    const groups = [...demand.keys()].sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
    for (const cadreId of groups) {
      const need = demand.get(cadreId)!;
      const pool = staff.filter((s) => !s.morningOnly && !done.has(s.id) && (cadreId === null || s.cadreId === cadreId) && (ruleFor(s, true) || ruleFor(s, false)));
      if (!pool.length) continue;
      const nightShifts = duty.filter((x) => x.isOvernight);
      const dayShifts = duty.filter((x) => !x.isOvernight);
      const canNight = (s: EStaff) => Boolean(ruleFor(s, true)) && !s.excludedFromNights && nightShifts.some((x) => !ineligibleReason(s, x));
      const canDay = (s: EStaff) => Boolean(ruleFor(s, false)) && dayShifts.some((x) => !ineligibleReason(s, x));
      const takers = pool.filter(canNight);
      const dayers = pool.filter(canDay);

      const needOn = (d: number, x: string) => need.get(`${d}:${x}`) ?? 0;

      // ---- the lanes, cut into blocks
      interface Block { start: number; picks: [number, string][]; night: boolean }
      const blocks: Block[] = [];
      // A block that would break the weekly unbroken rest even for someone with nothing else that week is never laid out:
      // it is cut shorter, which also moves where the next block in the lane starts.
      const fitsAWeek = (picks: [number, string][]) => {
        const map = new Map(picks);
        const first = picks[0][0];
        const last = picks[picks.length - 1][0];
        for (let ws = week(first - 1); ws <= last + 1; ws += 7) if (weekBroken(ws, (d) => map.get(d))) return false;
        return true;
      };
      const cut = (laneDays: [number, string][], n: number, offset: number, night: boolean) => {
        // laneDays: the active days of one lane, in order, each with its shift. Split into runs of consecutive days first.
        const runs: [number, string][][] = [];
        for (const e of laneDays) {
          const cur = runs[runs.length - 1];
          if (cur && e[0] === cur[cur.length - 1][0] + 1) cur.push(e);
          else runs.push([e]);
        }
        runs.forEach((run, ri) => {
          let i = 0;
          let first = ri === 0 ? (n - (offset % n)) % n || n : n;
          while (i < run.length) {
            let len = Math.min(first, run.length - i);
            while (len > 1 && !fitsAWeek(run.slice(i, i + len))) len--;
            blocks.push({ start: run[i][0], picks: run.slice(i, i + len), night });
            i += len;
            first = n;
          }
        });
      };
      const lead = (list: EStaff[], night: boolean) => list.map((s) => ruleFor(s, night)!).find(Boolean);
      // Nights: one lane per person each night shift needs.
      const nightRule = lead(takers, true);
      if (nightRule) {
        const n = capOf(nightRule, true);
        for (const x of nightShifts) {
          let lanes = 0;
          for (let d = period.startDay; d <= period.endDay; d++) lanes = Math.max(lanes, needOn(d, x.id));
          for (let k = 0; k < lanes; k++) {
            const laneDays: [number, string][] = [];
            for (let d = period.startDay; d <= period.endDay; d++) if (needOn(d, x.id) > k) laneDays.push([d, x.id]);
            cut(laneDays, n, Math.floor((k * n) / lanes), true);
          }
        }
      }
      // Days: the day rule's own order makes paired lanes (one starting on each shift of the pair); what is left is single-shift lanes.
      const dayRule = lead(dayers, false);
      if (dayRule) {
        const n = capOf(dayRule, false);
        const pattern = (dayRule.blockShiftPatternIds ?? []).filter((id) => dayShifts.some((x) => x.id === id));
        const left = new Map<string, number>(); // `${d}:${x}` still to lay out
        for (let d = period.startDay; d <= period.endDay; d++) for (const x of dayShifts) left.set(`${d}:${x.id}`, needOn(d, x.id));
        const laneList: { days: [number, string][] }[] = [];
        if (pattern.length === 2 && pattern[0] !== pattern[1]) {
          const [p, q] = pattern;
          let pairs = 0;
          for (let d = period.startDay; d <= period.endDay; d++) pairs = Math.max(pairs, Math.min(needOn(d, p), needOn(d, q)));
          for (let k = 0; k < pairs; k++) {
            for (const first of [p, q]) {
              const second = first === p ? q : p;
              const laneDays: [number, string][] = [];
              for (let d = period.startDay; d <= period.endDay; d++) {
                if (Math.min(needOn(d, p), needOn(d, q)) <= k) continue;
                const x = (d - period.startDay) % 2 === 0 ? first : second;
                laneDays.push([d, x]);
                left.set(`${d}:${x}`, left.get(`${d}:${x}`)! - 1);
              }
              laneList.push({ days: laneDays });
            }
          }
        }
        for (const x of dayShifts) {
          let lanes = 0;
          for (let d = period.startDay; d <= period.endDay; d++) lanes = Math.max(lanes, left.get(`${d}:${x.id}`)!);
          for (let k = 0; k < lanes; k++) {
            const laneDays: [number, string][] = [];
            for (let d = period.startDay; d <= period.endDay; d++) if (left.get(`${d}:${x.id}`)! > k) laneDays.push([d, x.id]);
            laneList.push({ days: laneDays });
          }
        }
        laneList.forEach((l, k) => cut(l.days, n, Math.floor((k * n) / Math.max(1, laneList.length)), false));
      }
      blocks.sort((a, b) => a.start - b.start || Number(b.night) - Number(a.night) || b.picks.length - a.picks.length);

      // ---- who works each block
      let totalNight = 0;
      let totalAll = 0;
      for (const b of blocks) {
        totalAll += b.picks.length;
        if (b.night) totalNight += b.picks.length;
      }
      // Fair by hours, not by duty count: a 12-hour night weighs twice a 6-hour morning. Loads are kept in "average duties"
      // (hours divided by the average duty's hours), so the weights below read the same whatever the shift lengths.
      const totalHours = blocks.reduce((t, b) => t + b.picks.reduce((h, [, x]) => h + hoursOf(shiftById.get(x)!), 0), 0);
      const avgH = totalAll ? totalHours / totalAll : 1;
      const loadOf = (b: Block) => b.picks.reduce((h, [, x]) => h + hoursOf(shiftById.get(x)!), 0) / avgH;
      const meanLast90 = takers.length ? takers.reduce((t, x) => t + nightsLast90(x.id), 0) / takers.length : 0;
      // Nights by count, against an even share, less whatever extra they did in the last three months.
      const nightShareOf = (s: EStaff) => totalNight / Math.max(1, takers.length) - 0.5 * (nightsLast90(s.id) - meanLast90);
      interface Who { s: EStaff; plan: Map<number, string>; target: number; nights: number; free: number; lastNight: boolean; lastShift: string | null; special: number; hols: number; duties: number }
      const people: Who[] = pool.map((s) => {
        const mine = by.get(s.id)!;
        let last = -Infinity;
        for (const d of mine.keys()) if (d < period.startDay && shiftById.get(mine.get(d)!)?.countsAsDuty) last = Math.max(last, d);
        const lastShift = last > -Infinity ? mine.get(last)! : null;
        const lastNight = lastShift ? shiftById.get(lastShift)!.isOvernight : false;
        const r = lastShift ? ruleFor(s, lastNight) : undefined;
        const adjust = (input.settlement?.[s.id] ?? 0) + (carryTotal[s.id] ?? 0);
        return {
          s, plan: new Map(), target: (totalAll / pool.length) * 1.04 + adjust,
          // A run that began last month may carry straight on; otherwise the rest it earned comes first.
          free: last > -Infinity ? (last === period.startDay - 1 ? period.startDay : last + 1 + (r?.offDaysRequired ?? 0)) : period.startDay,
          lastNight, lastShift, special: 0, hols: 0, duties: 0, nights: 0,
        };
      });
      const meanSpecial = () => people.reduce((t, p) => t + p.special, 0) / people.length;
      const owners: { b: Block; w: Who }[] = [];

      for (const b of blocks) {
        const kindRule = (s: EStaff) => ruleFor(s, b.night);
        let best: { w: Who; cost: number } | null = null;
        for (const w of people) {
          const s = w.s;
          if (b.night ? !canNight(s) : !canDay(s)) continue;
          if (b.start < w.free) continue;
          const mine = by.get(s.id)!;
          const st0 = state.get(s.id)!;
          if (b.picks.some(([d, x]) => staticReason(s, shiftById.get(x)!, d) || st0.rest.get(d) === "BLOCK" || mine.has(d))) continue;
          // The person's own limits for the month.
          if (b.night && s.maxNightsPerMonth && w.nights + b.picks.length > s.maxNightsPerMonth) continue;
          if (s.maxHoursPerMonth && (w.duties + loadOf(b)) * avgH > s.maxHoursPerMonth + 0.01) continue;
          // Days off in the month (C14), and full weekends off (C13).
          const dutyOfPlan = (d: number) => w.plan.get(d) ?? mine.get(d);
          if (c14 !== null) {
            let n = b.picks.length;
            for (let d = period.startDay; d <= period.endDay; d++) if (dutyOfPlan(d)) n++;
            if (n > days - c14) continue;
          }
          let cost = 0;
          if (c13 !== null && b.picks.some(([d, x]) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || (weekdayOf(d) === 5 && shiftById.get(x)!.isOvernight))) {
            const before = freeWeekends(dutyOfPlan);
            const after = freeWeekends((d) => b.picks.find(([x]) => x === d)?.[1] ?? dutyOfPlan(d));
            if (after < before && after < Math.min(c13, saturdays.length)) {
              if (rule.get("C13")!.severity === "BLOCK") continue;
              cost += 40;
            }
          }
          // Days the person has asked to have off, still waiting for a decision.
          cost += ASKED_OFF * b.picks.filter(([d]) => askedOff.has(`${s.id}:${d}`)).length;
          const nightShare = nightShareOf(s);
          if (b.night) {
            const over = w.nights + b.picks.length - nightShare;
            cost += over > 0.5 ? 15 * over : -5 * Math.min(b.picks.length, -over + 0.5);
          } else if (canNight(s)) {
            // Someone who still owes nights is kept free for them; day blocks go first to those who do not take nights.
            cost += 2 * Math.max(0, nightShare - w.nights);
          }
          // A fair pace through the month; someone more than a block behind is pulled in hard, so nobody is left with a thin month.
          const end = b.picks[b.picks.length - 1][0];
          const ahead = (w.duties + loadOf(b)) - (w.target * (end - period.startDay + 1)) / days;
          cost += 3 * ahead + (ahead < -3 ? 12 * (ahead + 3) : 0);
          // The rotation order: the block after a rest starts on the next shift in the person's rotation.
          const rot = rotationOf.get(s.id);
          if (rot && w.lastShift) {
            const seq = rot.sequenceShiftIds;
            const from = seq.indexOf(w.lastShift);
            const to = seq.indexOf(b.picks[0][1]);
            if (from >= 0 && to >= 0) {
              const dist = (to - from + seq.length) % seq.length;
              if (dist === 1) cost -= 8;
              else {
                if (rot.enforcement === "BLOCK") continue;
                cost += 20;
              }
            }
          }
          // Weekends and public holidays shared, with last months' share counted.
          const sp = b.picks.filter(([d]) => isSpecial(d)).length;
          cost += sp * (1.5 * (w.special - meanSpecial()) + 0.7 * (carrySpecial[s.id] ?? 0));
          const hol = b.picks.filter(([d]) => holidays.has(d)).length;
          if (hol) cost += hol * (20 * (holidayCarry[s.id] ?? 0) + 100 * w.hols);
          // Each week keeps its unbroken rest.
          const dutyOf = (d: number) => b.picks.find(([x]) => x === d)?.[1] ?? w.plan.get(d) ?? mine.get(d);
          let broken = false;
          for (let ws = week(b.start - 1); ws <= end + 1 && !broken; ws += 7) if (weekBroken(ws, dutyOf)) broken = true;
          if (broken) continue;
          cost += jitter();
          if (!best || cost < best.cost) best = { w, cost };
        }
        if (!best) continue; // nobody can take it whole: the day-by-day pass fills these days
        const w = best.w;
        for (const [d, x] of b.picks) w.plan.set(d, x);
        const end = b.picks[b.picks.length - 1][0];
        const r = kindRule(w.s)!;
        w.free = end + 1 + r.offDaysRequired;
        w.lastNight = b.night;
        w.lastShift = b.picks[b.picks.length - 1][1];
        w.duties += loadOf(b);
        if (b.night) w.nights += b.picks.length;
        w.special += b.picks.filter(([d]) => isSpecial(d)).length;
        w.hols += b.picks.filter(([d]) => holidays.has(d)).length;
        owners.push({ b, w });
      }

      // Evening out: a block taken by someone well above their share moves, whole, to someone well below it who could have
      // worked it (rested either side, not on leave, the week's rest kept, not past their nights), latest blocks first.
      const restOf = (s: EStaff) => Math.max(ruleFor(s, true)?.offDaysRequired ?? 0, ruleFor(s, false)?.offDaysRequired ?? 0);
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (const o of [...owners].sort((x, y) => y.b.start - x.b.start)) {
          const { b } = o;
          const over = o.w.duties - o.w.target;
          if (over <= 1) continue;
          const first = b.picks[0][0];
          const last = b.picks[b.picks.length - 1][0];
          const under = people
            .filter((u) => u !== o.w && o.w.duties - loadOf(b) >= u.duties + loadOf(b) - 1 && u.duties - u.target < -1)
            .sort((x, y) => x.duties - x.target - (y.duties - y.target));
          for (const u of under) {
            const s = u.s;
            if (b.night ? !canNight(s) || u.nights >= nightShareOf(s) : !canDay(s)) continue;
            const mine = by.get(s.id)!;
            const st0 = state.get(s.id)!;
            if (b.picks.some(([d, x]) => staticReason(s, shiftById.get(x)!, d) || st0.rest.get(d) === "BLOCK" || mine.has(d) || askedOff.has(`${s.id}:${d}`))) continue;
            if (b.night && s.maxNightsPerMonth && u.nights + b.picks.length > s.maxNightsPerMonth) continue;
            if (s.maxHoursPerMonth && (u.duties + loadOf(b)) * avgH > s.maxHoursPerMonth + 0.01) continue;
            const gap = restOf(s);
            let clash = false;
            for (let d = first - gap - 1; d <= last + gap + 1 && !clash; d++) if (u.plan.has(d) || (d < period.startDay && mine.has(d) && d >= first - gap)) clash = true;
            if (clash) continue;
            const rot = rotationOf.get(s.id);
            if (rot?.enforcement === "BLOCK") continue;
            const dutyOf = (d: number) => b.picks.find(([x]) => x === d)?.[1] ?? u.plan.get(d) ?? mine.get(d);
            let broken = false;
            for (let ws = week(first - 1); ws <= last + 1 && !broken; ws += 7) if (weekBroken(ws, dutyOf)) broken = true;
            if (broken) continue;
            // The same days-off and weekend checks as when the block was first given out.
            const planOf = (d: number) => u.plan.get(d) ?? mine.get(d);
            if (c14 !== null && [...Array(days)].filter((_, i) => dutyOf(period.startDay + i)).length > days - c14) continue;
            if (c13 !== null && freeWeekends(dutyOf) < freeWeekends(planOf) && freeWeekends(dutyOf) < Math.min(c13, saturdays.length)) continue;
            for (const [d] of b.picks) o.w.plan.delete(d);
            for (const [d, x] of b.picks) u.plan.set(d, x);
            const sp = b.picks.filter(([d]) => isSpecial(d)).length;
            const hl = b.picks.filter(([d]) => holidays.has(d)).length;
            o.w.duties -= loadOf(b); u.duties += loadOf(b);
            o.w.special -= sp; u.special += sp;
            o.w.hols -= hl; u.hols += hl;
            if (b.night) { o.w.nights -= b.picks.length; u.nights += b.picks.length; }
            o.w = u;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }

      for (const w of people) {
        intent.set(w.s.id, w.plan);
        done.add(w.s.id);
      }
    }
  }

  for (let day = period.startDay; day <= period.endDay; day++) {
    for (const slot of slotsOf(day).slots) {
      let best: { s: EStaff; score: number } | null = null;
      for (const s of staff) {
        if (slot.cadreId && s.cadreId !== slot.cadreId) continue;
        if (hardReason(s, slot.shift, day, intent.get(s.id)?.get(day) === slot.shift.id)) continue;
        const check = dutyCheck(state.get(s.id)!, cycleRules.get(s.id)!, day, slot.shift);
        if (check.hard) continue;
        const rot = rotationCheck(s, slot.shift, day);
        if (rot.hard) continue;
        // A place that needs a lead goes to someone who can lead, unless nobody can: then the shift is still staffed and the roster says it has no lead.
        const sc = score(s, slot.shift, day) + check.soft + rot.soft + jitter() + (slot.lead && !s.canLead ? 1000 : 0) + (askedOff.has(`${s.id}:${day}`) ? ASKED_OFF : 0);
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
    const st = freshState(rotationOf.get(s.id));
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
    let stray = 0;
    for (const [d, sid] of mine) {
      if (d < period.startDay || d > period.endDay) continue;
      const sh = shiftById.get(sid)!;
      const before = mine.get(d - 1);
      const after = mine.get(d + 1);
      if (planBlocks && !before && !after) stray += sh.isOvernight ? ISOLATED_NIGHT : ISOLATED_DUTY;
      if (planBlocks && after && shiftById.get(after)!.isOvernight !== sh.isOvernight) stray += FLIP;
      if (sh.isOvernight) nights++;
      if (weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d)) special++;
      hours += hoursOf(sh);
      if (mine.has(d + 1)) pairs++;
    }
    const { soft } = scan(s);
    // Moving a duty off the planned blocks costs as much as it would in the day-by-day pass.
    let offPlan = 0;
    const plan = intent.get(s.id);
    if (plan) {
      for (const [d, sid] of mine) if (d >= period.startDay && d <= period.endDay && plan.get(d) !== sid) offPlan++;
      for (const [d, sid] of plan) if (mine.get(d) !== sid) offPlan++;
    }
    let asked = 0;
    for (const [d] of mine) if (askedOff.has(`${s.id}:${d}`)) asked++;
    return nightWeight * nights * nights + 4 * special * special + 2 * (hours / 40) * (hours / 40) - BLOCK_REWARD * pairs + stray + soft + 30 * offPlan + ASKED_OFF * asked;
  };

  const violations = (s: EStaff): number => {
    const mine = by.get(s.id)!;
    const list: EAssignment[] = [...mine].map(([day, shiftId]) => ({ staffId: s.id, shiftId, day }));
    const ctx: EContext = { staff: [s], shifts: input.shifts, assignments: list, leave: input.leave.filter((l) => l.staffId === s.id), period, weekStartsOn: input.weekStartsOn, referenceWeeks: input.referenceWeeks };
    let violationsCount = 0;
    let n = 0;
    for (const code of HARD_CODES) {
      const r = rule.get(code);
      // A broken Block rule outweighs any number of warnings, so no move ever trades warnings for one.
      if (r) n += RULE_EVALUATORS[code](r, ctx).length * (r.severity === "BLOCK" ? 1_000_000 : 1);
    }
    if (s.maxDutiesPerWeek > 0) {
      const perWeek = new Map<number, number>();
      for (const [d] of mine) if (d >= period.startDay && d <= period.endDay) perWeek.set(week(d), (perWeek.get(week(d)) ?? 0) + 1);
      for (const n of perWeek.values()) if (n > s.maxDutiesPerWeek) violationsCount++;
    }
    // A run longer than the person's own duty cycle allows (five nights where the cycle says four), Prefer or not:
    // a move made to tidy the roster may never create one.
    let overruns = 0;
    for (const cr of cycleRules.get(s.id)!) {
      let run = 0;
      for (let d = period.startDay - LOOKBACK; d <= period.endDay; d++) {
        const sid = mine.get(d);
        run = sid && cr.countingShiftIds.includes(sid) ? run + 1 : 0;
        if (run > cr.consecutiveDuties && d >= period.startDay) overruns++;
      }
    }
    // The person's own monthly limits, which no tidying move may break either.
    let nights = 0;
    let hours = 0;
    for (const [d, sid] of mine) {
      if (d < period.startDay || d > period.endDay) continue;
      if (shiftById.get(sid)!.isOvernight) nights++;
      hours += hoursOf(shiftById.get(sid)!);
    }
    if (s.maxNightsPerMonth && nights > s.maxNightsPerMonth) violationsCount += nights - s.maxNightsPerMonth;
    if (s.maxHoursPerMonth && hours > s.maxHoursPerMonth) violationsCount++;
    // Off blocks, the shift after a rest, and block orders that are set to Block.
    return n + 1_000_000 * (violationsCount + scan(s).hard) + 1000 * overruns;
  };

  const lockedKeys = new Set(input.locked.map((l) => `${l.staffId}:${l.day}`));
  /** Handing a duty from someone who can lead to someone who cannot would take the lead off a shift that asks for one. */
  const losesLead = (from: EStaff, to: EStaff, shift: EShift) => Boolean(shift.minLeads) && Boolean(from.canLead) && !to.canLead;
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
        .filter((r) => !chain.has(r.id) && r.id !== c.id && r.cadreId === c.cadreId && !r.morningOnly && !lockedKeys.has(`${r.id}:${move.day}`) && !losesLead(c, r, moved))
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
      if (losesLead(sa, sb, shiftA) || losesLead(sb, sa, shiftB)) continue;
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
      if (staticReason(to, shift, a.day) || by.get(to.id)!.has(a.day) || lockedKeys.has(`${from.id}:${a.day}`) || losesLead(from, to, shift)) continue;
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
      const st = freshState(rotationOf.get(s.id));
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
  let scatter = 0;
  for (const s of staff) {
    const mine = by.get(s.id)!;
    for (const [d, sid] of mine) {
      if (d < period.startDay || d > period.endDay || !shiftById.get(sid)?.countsAsDuty) continue;
      const after = mine.get(d + 1);
      if (!mine.has(d - 1) && !after) scatter++;
      if (after && shiftById.get(after)!.isOvernight !== shiftById.get(sid)!.isOvernight) scatter++;
    }
  }
  const findings = evaluateCompliance(input.rules, {
    staff, shifts: input.shifts, assignments, leave: input.leave, period, weekStartsOn: input.weekStartsOn, referenceWeeks: input.referenceWeeks, cadreNames: input.cadreNames, holidays: input.holidays,
  });
  return { feasible: true, shortfalls: [], cells, unfilled, findings, stats: { duties: generated.length + fixed.length, unfilled: unfilled.length, improvements, carried: Object.values(carryTotal).filter((n) => n !== 0).length, scatter } };
}
