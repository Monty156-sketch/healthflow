import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { A, M, N, OFF, CYCLES, RULES, person, periodFrom } from "./engineKit.js";

const period = periodFrom(2026, 10, 1, 31);
const shifts = [{ ...A, minStaff: 3, minByCadre: { mid: 1 } }, { ...M, minStaff: 3, minByCadre: { mid: 1 } }, { ...N, minStaff: 3, minByCadre: { mid: 1 } }, OFF];
const run = (midwives: number, others: number) => {
  let n = 0;
  const staff = [["mid", midwives], ["rgn", others]].flatMap(([cadre, count]) => Array.from({ length: count as number }, () => { n += 1; return person(n, { cadreId: cadre as string }); }));
  return generate({ staff, shifts, offShiftId: "D/O", rules: RULES, cycles: CYCLES, leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [] });
};

describe("closing gaps by moving duties", () => {
  it("fills every midwife slot when eight midwives can cover them, which one pass forwards could not", () => {
    const r = run(8, 8);
    expect(r.unfilled).toHaveLength(0);
    // Twelve-hour nights in a four-night block pass the 40-hour week, which is set to Warn: the facility's own cycle may do that.
    expect(r.findings.filter((f) => f.severity === "BLOCK")).toEqual([]);
    expect(r.findings.filter((f) => !["C2", "C4", "C7", "C8"].includes(f.ruleCode))).toEqual([]);
  });

  it("never trades a gap for a broken rest or hours rule", () => {
    for (const [mids, others] of [[6, 8], [7, 8], [9, 8]]) {
      const r = run(mids, others);
      expect(r.findings.filter((f) => f.ruleCode !== "C11" && f.severity === "BLOCK")).toEqual([]);
      expect(r.findings.filter((f) => f.ruleCode !== "C11" && !["C2", "C4", "C7", "C8"].includes(f.ruleCode))).toEqual([]);
    }
  });

  it("keeps the weekly hours when that limit is set to Block", () => {
    let n = 0;
    const staff = [["mid", 8], ["rgn", 8]].flatMap(([cadre, count]) => Array.from({ length: count as number }, () => { n += 1; return person(n, { cadreId: cadre as string }); }));
    const rules = RULES.map((r) => (r.code === "C2" ? { ...r, severity: "BLOCK" as const } : r));
    const r = generate({ staff, shifts, offShiftId: "D/O", rules, cycles: CYCLES, leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [] });
    expect(r.findings.filter((f) => f.ruleCode === "C2")).toEqual([]);
  });

  it("still reports the gap that no arrangement can close", () => {
    const r = run(3, 8);
    expect(r.unfilled.length).toBeGreaterThan(20);
    expect(r.unfilled.filter((u) => u.cadreId === "mid").length).toBeGreaterThan(20);
  });

  it("gives the same roster for the same inputs", () => {
    expect(JSON.stringify(run(7, 8).cells)).toBe(JSON.stringify(run(7, 8).cells));
  });
});
