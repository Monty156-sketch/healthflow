// Cycle-first planning. The duty cycle says how many duties in a row and how many
// days off; the rotation says which shift comes after which. A person's month is
// therefore a chain of blocks: N days of one shift, M days off, then the next
// shift in their rotation, and so on. This module only chooses where in that chain
// each person starts so that the minimums are covered as well as the chain allows.
// A cycle is never bent to fill a gap: a minimum that cannot be met stays visible.
import type { ECycleRule, ERotation, EShift, EStaff, Period } from "./types.js";
import { weekdayOf } from "./time.js";
import { demandOn } from "./demand.js";
import { ineligibleReason } from "./evaluators.js";

export interface CyclePlanInput {
  /** People whose month follows their cycle rules. */
  staff: EStaff[];
  rulesOf: (s: EStaff) => ECycleRule[];
  rotationOf: (s: EStaff) => ERotation | null;
  shiftById: Map<string, EShift>;
  duty: EShift[];
  period: Period;
  holidays: Set<number>;
  /** True when this person cannot work this shift on this day (leave, approved day off, no nights for now). */
  blocked: (s: EStaff, shift: EShift, day: number) => boolean;
  /** Everything known about each person before the month, and anything already fixed in it. */
  by: Map<string, Map<number, string>>;
  /** People who are not planned here but already have duties in the month (in-charges, locked cells). */
  fixedStaff: EStaff[];
  /** Public holidays worked over the last twelve months. */
  holidayWorked?: Record<string, number>;
  /** 0 for the plain order; anything else breaks ties differently. */
  jitter: () => number;
}

interface Lane {
  s: EStaff;
  seq: EShift[];
  n: number[];
  m: number[];
  cands: { idx: number; pos: number; pen: number; wait?: number }[];
}

const SHORT = 10;
const OVER = 0.4;
const SPECIAL_SQ = 2;
const TOTAL_SQ = 0.15;
const LOOKBACK = 14;

export function planCycles(input: CyclePlanInput): Map<string, Map<number, string>> {
  const { period, holidays } = input;
  const out = new Map<string, Map<number, string>>();
  const days: number[] = [];
  for (let d = period.startDay; d <= period.endDay; d++) days.push(d);
  const isSpecial = (d: number) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || holidays.has(d);

  // ---- lanes: the chain of shifts each person can follow
  const lanes: Lane[] = [];
  for (const s of input.staff) {
    const rules = input.rulesOf(s);
    if (!rules.length) continue;
    const ruleFor = (shiftId: string) => rules.find((r) => r.countingShiftIds.includes(shiftId));
    const ok = (sh: EShift | undefined): sh is EShift => !!sh && sh.countsAsDuty && !sh.isOnCall && !!ruleFor(sh.id) && !ineligibleReason(s, sh);
    const rot = input.rotationOf(s);
    let seq = (rot?.sequenceShiftIds ?? []).map((id) => input.shiftById.get(id)).filter(ok);
    if (!seq.length) {
      const counted = new Set(rules.flatMap((r) => r.countingShiftIds));
      seq = input.duty.filter((sh) => counted.has(sh.id)).filter(ok);
    }
    if (!seq.length) continue;
    const n = seq.map((sh) => Math.max(1, ruleFor(sh.id)!.consecutiveDuties));
    const m = seq.map((sh) => Math.max(0, ruleFor(sh.id)!.offDaysRequired));
    lanes.push({ s, seq, n, m, cands: candidatesOf(s, seq, n, m, input.by.get(s.id) ?? new Map(), period.startDay) });
  }
  if (!lanes.length) return out;

  // ---- demand and what is already covered
  interface Need { total: number; cad: [string, number][]; leads: number }
  const need = new Map<string, Need>();
  const cov = new Map<string, { total: number; cad: Map<string, number>; leads: number }>();
  const key = (d: number, sid: string) => `${d}:${sid}`;
  let specialSlots = 0;
  let holidaySlots = 0;
  let allSlots = 0;
  for (const d of days) {
    for (const sh of input.duty) {
      const dm = demandOn(sh, d, holidays);
      const cad = Object.entries(dm.minByCadre);
      const total = Math.max(dm.minStaff, cad.reduce((t, [, v]) => t + v, 0));
      if (total <= 0) continue;
      need.set(key(d, sh.id), { total, cad, leads: sh.minLeads ?? 0 });
      cov.set(key(d, sh.id), { total: 0, cad: new Map(), leads: 0 });
      allSlots += total;
      if (isSpecial(d)) specialSlots += total;
      if (holidays.has(d)) holidaySlots += total;
    }
  }
  const add = (s: EStaff, d: number, sid: string, by: 1 | -1) => {
    const c = cov.get(key(d, sid));
    if (!c) return;
    c.total += by;
    if (s.cadreId) c.cad.set(s.cadreId, (c.cad.get(s.cadreId) ?? 0) + by);
    if (s.canLead) c.leads += by;
  };
  const fixedIds = new Set(input.fixedStaff.map((s) => s.id));
  for (const s of input.fixedStaff) {
    for (const [d, sid] of input.by.get(s.id) ?? []) if (d >= period.startDay && d <= period.endDay) add(s, d, sid, 1);
  }
  const lostAt = (k: string, c: { total: number; cad: Map<string, number>; leads: number }) => {
    const nd = need.get(k);
    if (!nd) return 0;
    let lost = Math.max(0, nd.total - c.total);
    for (const [cad, v] of nd.cad) lost += Math.max(0, v - (c.cad.get(cad) ?? 0));
    if (nd.leads) lost += Math.max(0, nd.leads - c.leads);
    return SHORT * lost + OVER * Math.max(0, c.total - nd.total);
  };

  // ---- fairness: weekends and holidays are shared; whoever carried more in the last ninety days carries less now
  const specialHist = new Map<string, number>();
  const sharedLanes = lanes.length;
  for (const l of lanes) {
    let sp = 0;
    for (const [d] of input.by.get(l.s.id) ?? []) if (d < period.startDay && d >= period.startDay - 90 && isSpecial(d)) sp++;
    specialHist.set(l.s.id, sp);
  }
  const meanHist = [...specialHist.values()].reduce((t, v) => t + v, 0) / Math.max(1, sharedLanes);
  const carrySpecial = (id: string) => Math.max(-4, Math.min(4, Math.round(((specialHist.get(id) ?? 0) - meanHist) / 2)));
  const holMean = lanes.reduce((t, l) => t + (input.holidayWorked?.[l.s.id] ?? 0), 0) / Math.max(1, sharedLanes);
  const carryHoliday = (id: string) => Math.max(-4, Math.min(4, (input.holidayWorked?.[id] ?? 0) - holMean));
  let fixedSpecial = 0;
  let fixedHoliday = 0;
  let fixedAll = 0;
  for (const s of input.fixedStaff) {
    for (const [d] of input.by.get(s.id) ?? []) {
      if (d < period.startDay || d > period.endDay) continue;
      fixedAll++;
      if (isSpecial(d)) fixedSpecial++;
      if (holidays.has(d)) fixedHoliday++;
    }
  }
  void fixedIds;
  const targetSpecial = Math.max(0, specialSlots - fixedSpecial) / sharedLanes;
  const targetHoliday = Math.max(0, holidaySlots - fixedHoliday) / sharedLanes;
  const targetTotal = Math.max(0, allSlots - fixedAll) / sharedLanes;

  interface Tally { total: number; special: number; holiday: number }
  const timeline = (lane: Lane, c: { idx: number; pos: number; wait?: number }) => {
    const out = new Map<number, string>();
    let idx = c.idx;
    let pos = c.pos;
    let wait = c.wait ?? 0;
    const len = lane.seq.length;
    for (const d of days) {
      if (pos >= lane.n[idx] + lane.m[idx]) {
        idx = (idx + 1) % len;
        pos = 0;
      }
      if (pos === 0) {
        // A block that cannot start today (leave, no nights) hands over to the next shift in the rotation.
        for (let t = 0; t < len && input.blocked(lane.s, lane.seq[idx], d); t++) idx = (idx + 1) % len;
      }
      if (pos === 0 && wait > 0 && !input.blocked(lane.s, lane.seq[idx], d)) {
        // Someone coming back from leave can wait a few days so the team's blocks do not all start together.
        wait--;
        continue;
      }
      if (pos < lane.n[idx]) {
        if (input.blocked(lane.s, lane.seq[idx], d)) pos = 0;
        else {
          out.set(d, lane.seq[idx].id);
          pos++;
        }
      } else pos++;
    }
    return out;
  };
  const tallyOf = (tl: Map<number, string>): Tally => {
    const t = { total: 0, special: 0, holiday: 0 };
    for (const [d] of tl) {
      t.total++;
      if (isSpecial(d)) t.special++;
      if (holidays.has(d)) t.holiday++;
    }
    return t;
  };
  const fairness = (lane: Lane, t: Tally) =>
    SPECIAL_SQ * (t.special + carrySpecial(lane.s.id) - targetSpecial) ** 2 +
    SPECIAL_SQ * 2 * (t.holiday + carryHoliday(lane.s.id) - targetHoliday) ** 2 +
    TOTAL_SQ * (t.total - targetTotal) ** 2;

  /** Cost change from adding this timeline to what is covered now. */
  const addedCost = (lane: Lane, tl: Map<number, string>) => {
    let delta = 0;
    for (const [d, sid] of tl) {
      const k = key(d, sid);
      const c = cov.get(k);
      if (!c) {
        continue;
      }
      const before = lostAt(k, c);
      add(lane.s, d, sid, 1);
      delta += lostAt(k, c) - before;
      add(lane.s, d, sid, -1);
    }
    return delta + fairness(lane, tallyOf(tl));
  };

  const chosen = new Map<string, Map<number, string>>();
  const place = (lane: Lane): boolean => {
    let best: Map<number, string> | null = null;
    let bestCost = Infinity;
    for (const c of lane.cands) {
      const tl = timeline(lane, c);
      const cost = addedCost(lane, tl) + c.pen + input.jitter() * 0.05;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = tl;
      }
    }
    const prev = chosen.get(lane.s.id);
    chosen.set(lane.s.id, best!);
    let moved = !prev;
    if (prev && best) {
      if (prev.size !== best.size) moved = true;
      else for (const [d, sid] of best) if (prev.get(d) !== sid) moved = true;
    }
    return moved;
  };
  const apply = (lane: Lane, tl: Map<number, string>, by: 1 | -1) => {
    for (const [d, sid] of tl) add(lane.s, d, sid, by);
  };

  // People whose place in the chain is already decided by last month go first; the rest fit around them.
  const ordered = [...lanes].sort((a, b) => a.cands.length - b.cands.length || a.s.staffNo.localeCompare(b.s.staffNo, undefined, { numeric: true }));
  for (const lane of ordered) {
    place(lane);
    apply(lane, chosen.get(lane.s.id)!, 1);
  }
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const lane of ordered) {
      if (lane.cands.length < 2) continue;
      apply(lane, chosen.get(lane.s.id)!, -1);
      if (place(lane)) changed = true;
      apply(lane, chosen.get(lane.s.id)!, 1);
    }
    if (!changed) break;
  }
  for (const lane of lanes) out.set(lane.s.id, chosen.get(lane.s.id)!);
  return out;
}

/**
 * Where in its chain a person can be on the first day of the month. Last month
 * decides it when they were mid-block or resting; otherwise any place in any
 * block is possible and the coverage picks.
 */
function candidatesOf(s: EStaff, seq: EShift[], n: number[], m: number[], mine: Map<number, string>, startDay: number) {
  const idxOf = (id: string) => seq.findIndex((x) => x.id === id);
  let lastDay = -1;
  for (let d = startDay - 1; d >= startDay - LOOKBACK; d--) {
    if (mine.has(d)) {
      lastDay = d;
      break;
    }
  }
  const free = () => {
    const out: { idx: number; pos: number; pen: number; wait?: number }[] = [];
    const succ = lastDay >= 0 && idxOf(mine.get(lastDay)!) >= 0 ? (idxOf(mine.get(lastDay)!) + 1) % seq.length : -1;
    for (let idx = 0; idx < seq.length; idx++) {
      const pen = succ >= 0 && idx !== succ ? 2 : 0;
      for (let pos = 0; pos < n[idx] + m[idx]; pos++) out.push({ idx, pos, pen });
      for (let wait = 1; wait < n[idx] + m[idx]; wait++) out.push({ idx, pos: 0, pen: pen + 0.5, wait });
    }
    return out;
  };
  if (lastDay < 0) return free();
  const lastShift = mine.get(lastDay)!;
  const li = idxOf(lastShift);
  if (li < 0) return free();
  let len = 0;
  for (let d = lastDay; d >= lastDay - 20 && mine.get(d) === lastShift; d--) len++;
  const offSince = startDay - 1 - lastDay;
  if (offSince === 0 && len < n[li]) return [{ idx: li, pos: len, pen: 0 }];
  if (len >= n[li] && offSince < m[li]) return [{ idx: li, pos: n[li] + offSince, pen: 0 }];
  // The rest is done, or the last block was cut short: start the next shift in the rotation.
  return [{ idx: (li + 1) % seq.length, pos: 0, pen: 0 }];
}
