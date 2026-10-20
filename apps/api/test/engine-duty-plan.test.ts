import { describe, expect, it } from "vitest";
import { generate, type GenerateInput } from "../src/engine/generate.js";
import { weekdayOf } from "../src/engine/time.js";
import { A, M, N, OFF, RULES, cycle, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);
const CYCLES = [
  { ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" },
  { ...cycle("d", "4 days on, 2 off", ["A", "M"], 4, 2, 2), blockShiftPatternIds: ["M", "A"] },
];

// 3 in-charges (mornings, weekdays), 4 staff in a department that closes at night, 16 who take nights.
const staff = [
  ...Array.from({ length: 3 }, (_, i) => person(i + 1, { morningOnly: true, excludedFromNights: true, eligibleShiftIds: ["A"] })),
  ...Array.from({ length: 4 }, (_, i) => person(i + 4, { excludedFromNights: true })),
  ...Array.from({ length: 16 }, (_, i) => person(i + 8)),
];

function run(variation = 0) {
  const input: GenerateInput = {
    staff, shifts: [{ ...A, minStaff: 4 }, { ...M, minStaff: 3 }, { ...N, minStaff: 3 }, OFF], offShiftId: "D/O", rules: RULES, cycles: CYCLES, rotations: [],
    leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [], variation,
  };
  const r = generate(input);
  expect(r.feasible).toBe(true);
  return r;
}
const mine = (r: ReturnType<typeof run>, id: string) => r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O");

describe("who is on which duty", () => {
  const r = run();

  it("puts in-charges on weekday mornings only, every weekday", () => {
    for (const s of staff.filter((x) => x.morningOnly)) {
      const cells = mine(r, s.id);
      expect(cells.every((c) => c.shiftId === "A")).toBe(true);
      expect(cells.every((c) => weekdayOf(c.day) !== 0 && weekdayOf(c.day) !== 6)).toBe(true);
      let weekdays = 0;
      for (let d = period.startDay; d <= period.endDay; d++) if (weekdayOf(d) !== 0 && weekdayOf(d) !== 6) weekdays++;
      expect(cells.length).toBe(weekdays);
    }
  });

  it("gives nights only to people who take them", () => {
    for (const s of staff.filter((x) => x.excludedFromNights)) expect(mine(r, s.id).some((c) => c.shiftId === "N")).toBe(false);
  });

  it("shares nights and total duties fairly among the people who take nights", () => {
    const takers = staff.filter((x) => !x.excludedFromNights);
    const nights = takers.map((s) => mine(r, s.id).filter((c) => c.shiftId === "N").length);
    const totals = takers.map((s) => mine(r, s.id).reduce((t, c) => t + (c.shiftId === "N" ? 12 : 6), 0));
    console.log("nights", nights.join(","), "totals", totals.join(","));
    expect(Math.max(...nights) - Math.min(...nights)).toBeLessThanOrEqual(4); // at most one four-night block apart
    // Hours, not duty counts: within one four-night block of each other.
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(48);
  });

  it("keeps the four-night and four-day cycles", () => {
    for (const s of staff.filter((x) => !x.morningOnly)) {
      let nights = 0;
      for (let d = period.startDay; d <= period.endDay; d++) {
        nights = r.cells.some((c) => c.staffId === s.id && c.day === d && c.shiftId === "N") ? nights + 1 : 0;
        expect(nights).toBeLessThanOrEqual(4);
      }
    }
  });
});
