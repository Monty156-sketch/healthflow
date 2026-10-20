import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { CYCLES, OFF, RULES, person, periodFrom, shift } from "./engineKit.js";
import { weekdayOf } from "../src/engine/time.js";

// Shifts close to a Ghanaian ward: a 7-hour morning and afternoon, a 10-hour night.
const A = shift("A", "Morning", 7 * 60, 7);
const M = shift("M", "Afternoon", 14 * 60, 7, { sortOrder: 1 });
const N = shift("N", "Night", 21 * 60, 10, { isOvernight: true, sortOrder: 2 });
const period = periodFrom(2026, 10, 1, 31);
const rules = RULES.map((r) => (r.code === "C8" ? { ...r, threshold: 4 } : r));
const input = (people: number) => ({
  staff: Array.from({ length: people }, (_, i) => person(i + 1)),
  shifts: [{ ...A, minStaff: 4 }, { ...M, minStaff: 3 }, { ...N, minStaff: 3 }, OFF],
  offShiftId: "D/O", rules, cycles: CYCLES, leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [],
});
const weekends = (r: ReturnType<typeof generate>, people: number) =>
  Array.from({ length: people }, (_, i) => r.cells.filter((c) => c.staffId === person(i + 1).id && c.shiftId !== "D/O" && (weekdayOf(c.day) === 0 || weekdayOf(c.day) === 6)).length);

describe("planned blocks", () => {
  for (const people of [18, 22]) {
    it(`with ${people} staff, works in blocks: far fewer stray days and night/day switches, no gap, no broken rule`, () => {
      const planned = generate(input(people));
      const plain = generate({ ...input(people), blocks: false });
      expect(planned.unfilled).toHaveLength(0);
      expect(planned.findings.filter((f) => f.severity === "BLOCK")).toEqual([]);
      expect(planned.stats.scatter).toBeLessThan(plain.stats.scatter * 0.6);
    });
  }

  it("shares weekends more evenly than filling day by day", () => {
    const w = weekends(generate(input(18)), 18);
    const p = weekends(generate({ ...input(18), blocks: false }), 18);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThan(Math.max(...p) - Math.min(...p));
  });

  it("falls back to day-by-day filling when that leaves fewer gaps", () => {
    const tight = input(14);
    const best = generate(tight);
    const plain = generate({ ...tight, blocks: false });
    expect(best.unfilled.length).toBeLessThanOrEqual(plain.unfilled.length);
  });

  it("gives the same roster for the same inputs", () => {
    expect(JSON.stringify(generate(input(18)).cells)).toBe(JSON.stringify(generate(input(18)).cells));
  });
});
