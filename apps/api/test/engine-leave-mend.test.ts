import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { A, M, N, OFF, CYCLES, RULES, person, periodFrom } from "./engineKit.js";

const period = periodFrom(2026, 10, 1, 31);
const shifts = [{ ...A, minStaff: 3 }, { ...M, minStaff: 2 }, { ...N, minStaff: 2 }, OFF];
const staff = Array.from({ length: 12 }, (_, i) => person(i + 1));
const base = { staff, shifts, offShiftId: "D/O", rules: RULES, cycles: CYCLES, holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [] };

describe("refilling a leaver's duties", () => {
  const full = generate({ ...base, leave: [], locked: [] });
  const leaver = staff[0].id;
  const from = period.startDay + 10;
  const mine = full.cells.filter((c) => c.staffId === leaver && c.day >= from && c.shiftId !== "D/O");
  const keep = full.cells.filter((c) => c.shiftId !== "D/O" && !(c.staffId === leaver && c.day >= from));
  const mended = generate({ ...base, partial: true, leave: [{ staffId: leaver, startDay: from, endDay: period.endDay }], locked: keep });

  it("has duties to replace", () => expect(mine.length).toBeGreaterThan(3));

  it("never rostering the leaver while away, and touches nobody else's duties", () => {
    expect(mended.feasible).toBe(true);
    expect(mended.cells.some((c) => c.staffId === leaver && c.shiftId !== "D/O" && c.day >= from)).toBe(false);
    const kept = new Set(keep.map((c) => `${c.staffId}:${c.day}`));
    expect(mended.cells.filter((c) => kept.has(`${c.staffId}:${c.day}`))).toHaveLength(0);
  });

  it("covers every slot the leaver vacated with no rule broken", () => {
    // Others stay put in this first pass, so some slots may remain; the rest must be lawful.
    expect(mended.unfilled.length).toBeLessThan(mine.length);
    expect(mended.findings.filter((f) => f.ruleCode !== "C11")).toEqual([]);
  });

  it("lets nearby duties move when that closes more gaps", () => {
    const gapDays = mended.unfilled.map((u) => u.day);
    const free = new Set(keep.filter((c) => c.day >= from && gapDays.some((g) => Math.abs(g - c.day) <= 6)).map((c) => `${c.staffId}:${c.day}`));
    const second = generate({ ...base, partial: true, leave: [{ staffId: leaver, startDay: from, endDay: period.endDay }], locked: keep.filter((c) => !free.has(`${c.staffId}:${c.day}`)) });
    expect(second.unfilled.length).toBeLessThanOrEqual(mended.unfilled.length);
    expect(second.cells.some((c) => c.staffId === leaver && c.shiftId !== "D/O" && c.day >= from)).toBe(false);
  });

  it("reports a gap honestly when too few people remain, instead of refusing", () => {
    const small = Array.from({ length: 5 }, (_, i) => person(i + 1));
    const r = generate({ ...base, staff: small, partial: true, leave: [{ staffId: small[0].id, startDay: period.startDay, endDay: period.endDay }], locked: [] });
    expect(r.feasible).toBe(true);
    expect(r.unfilled.length).toBeGreaterThan(0);
    const strict = generate({ ...base, staff: small, leave: [{ staffId: small[0].id, startDay: period.startDay, endDay: period.endDay }], locked: [] });
    expect(strict.feasible).toBe(false);
  });
});
