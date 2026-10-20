import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { staffingCheck } from "../src/engine/staffing.js";
import { A, M, N, OFF, RULES, cycle, person, periodFrom } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);
const cycles = [{ ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" }, { ...cycle("d", "4 days on, 1 off", ["A", "M"], 4, 1, 2), blockShiftPatternIds: ["M", "A"] }];
const rules = RULES.map((r) => (r.code === "C8" ? { ...r, threshold: 4 } : r));
// A health centre of 13: six take nights.
const staff = Array.from({ length: 13 }, (_, i) => person(i + 1, { excludedFromNights: i >= 6 }));
const S = (a: number, m: number, n: number, extra: Partial<typeof A> = {}) => [{ ...A, minStaff: a, ...extra }, { ...M, minStaff: m }, { ...N, minStaff: n }, OFF];
const base = { staff, cycles, rules, leave: [], holidays: [], period };

describe("staffing check before generating", () => {
  it("says a month is short, by how much, and what would close it", () => {
    const c = staffingCheck({ ...base, shifts: S(4, 3, 3) });
    expect(c.verdict).toBe("SHORT");
    expect(c.duties.needed).toBe(300);
    expect(c.duties.possible).toBeLessThan(300);
    expect(c.nights.takersNeeded).toBeGreaterThanOrEqual(c.nightTakers);
    expect(c.suggestions.join(" ")).toMatch(/Saturdays, Sundays and public holidays/);
  });

  it("agrees with the generator: a month it calls short leaves gaps, one it calls fine does not", () => {
    const short = S(4, 3, 3);
    const fine = S(3, 2, 2);
    expect(staffingCheck({ ...base, shifts: fine }).verdict).not.toBe("SHORT");
    const g = (shifts: typeof short) => generate({ ...base, shifts, offShiftId: "D/O", weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [] });
    expect(g(short).unfilled.length).toBeGreaterThan(0);
    expect(g(fine).unfilled).toEqual([]);
  });
});

describe("which shift runs short first", () => {
  // Everyone may take nights here, so who covers what is a choice the order can make.
  const all = Array.from({ length: 13 }, (_, i) => person(i + 1));
  const run = (keep: { A?: number; M?: number; N?: number }) =>
    generate({ ...base, staff: all, shifts: [{ ...A, minStaff: 4, keepFull: keep.A ?? 0 }, { ...M, minStaff: 3, keepFull: keep.M ?? 0 }, { ...N, minStaff: 3, keepFull: keep.N ?? 0 }, OFF], offShiftId: "D/O", weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [] });
  const gaps = (r: ReturnType<typeof run>, id: string) => r.unfilled.filter((u) => u.shiftId === id).length;

  it("moves the gaps off a shift the facility keeps full, onto one it lets run short", () => {
    const plain = run({});
    const keepAfternoon = run({ M: 1, N: -1 });
    expect(plain.unfilled.length).toBeGreaterThan(0);
    expect(gaps(keepAfternoon, "M")).toBeLessThan(gaps(plain, "M") / 2);
    expect(gaps(keepAfternoon, "N")).toBeGreaterThan(gaps(plain, "N"));
    const keepMorning = run({ A: 1, M: -1 });
    expect(gaps(keepMorning, "A")).toBeLessThan(gaps(plain, "A"));
  }, 30_000);
});
