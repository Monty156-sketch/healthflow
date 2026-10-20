// The statutory violations fixture (spec Part 9, 3.1): a hand-built roster
// with deliberate breaches. Running the rules over it must give exactly the
// expected findings, no more and no fewer.
//
// The spec lists eight findings, but a few of its examples break other rules
// too: four nights in a row is also 48 hours in a week, seven morning shifts
// in a row leave no 48-hour rest, and staff_04's pattern as written also
// leaves no 48-hour rest. The assignments below are arranged so each
// deliberate breach is the one the spec names, and the extra findings that
// follow arithmetically from them are listed here too, so nothing is hidden.
import { describe, expect, it } from "vitest";
import { evaluateCompliance, RULE_EVALUATORS } from "../src/engine/evaluators.js";
import type { EAssignment, ELeave } from "../src/engine/types.js";
import { A, M, N, OFF, RULES, context, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 10, 5, 28); // a Monday
const day = (n: number) => period.startDay + n - 1;
const staff = Array.from({ length: 10 }, (_, i) => person(i + 1));
const put = (s: number, shift: string, ...days: number[]): EAssignment[] => days.map((d) => ({ staffId: `staff_${String(s).padStart(2, "0")}`, shiftId: shift, day: day(d) }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const assignments: EAssignment[] = [
  ...put(1, "N", 1, 2, 3, 4), ...put(1, "A", 6, 7),
  ...put(2, "N", 5), ...put(2, "A", 6),
  ...put(3, "A", ...range(1, 7)),
  ...put(4, "N", 5, 6, 7), ...put(4, "A", 9, 10),
  ...put(5, "A", 11),
  ...put(6, "N", 8), ...put(6, "M", 9),
  // staff_07 to staff_10: five on, two off
  ...[7, 8, 9, 10].flatMap((s) => [1, 8, 15, 22].flatMap((w) => put(s, s === 8 ? "M" : "A", ...range(w, w + 4)))),
];
const leave: ELeave[] = [{ staffId: "staff_05", startDay: day(10), endDay: day(12) }];

const seen = (findings: ReturnType<typeof evaluateCompliance>) => findings.map((f) => `${f.ruleCode} ${f.severity} ${f.staffId ?? "shift"}`).sort();

describe("statutory-violations-v1", () => {
  it("finds exactly the expected breaches", () => {
    const findings = evaluateCompliance(RULES, context({ staff, shifts: [A, M, N, OFF], assignments, leave, period }));
    expect(seen(findings)).toEqual(
      [
        "C2 WARN staff_01", "C3 BLOCK staff_01", "C8 WARN staff_01",
        "C6 BLOCK staff_02",
        "C2 WARN staff_03", "C3 BLOCK staff_03", "C7 WARN staff_03",
        "C2 WARN staff_04",
        "C9 BLOCK staff_05",
        "C5 BLOCK staff_06",
      ].sort()
    );
  });

  it("finds the night that is two people short on day 20 (C11)", () => {
    const night = { ...N, minStaff: 3 };
    const one = { ...period, startDay: day(20), endDay: day(20) };
    const two = ["staff_01", "staff_02"].map((staffId) => ({ staffId, shiftId: "N", day: day(20) }));
    const findings = evaluateCompliance(RULES, context({ staff, shifts: [A, M, night, OFF], assignments: two, period: one }));
    const c11 = findings.filter((f) => f.ruleCode === "C11");
    expect(c11).toHaveLength(1);
    expect(c11[0]).toMatchObject({ severity: "BLOCK", staffId: null, day: day(20), detail: { required: 3, assigned: 2 } });
    expect(c11[0].message).toBe("Night on 24 October has 2 of the 3 people it needs.");
  });

  it("every finding is a sentence naming the person and the dates", () => {
    const findings = evaluateCompliance(RULES, context({ staff, shifts: [A, M, N, OFF], assignments, leave, period }));
    const c8 = findings.find((f) => f.ruleCode === "C8")!;
    expect(c8.message).toBe("staff_01 — 4 consecutive night duties, 5 to 8 October. More than 3 in a row.");
    const c6 = findings.find((f) => f.ruleCode === "C6")!;
    expect(c6.message).toBe("staff_02 — A on 10 October starts at 08:00, but N on 9 October runs until 08:00. Both cannot be worked.");
  });

  it("a rule that is switched off finds nothing", () => {
    const off = RULES.filter((r) => r.code !== "C8");
    const findings = evaluateCompliance(off, context({ staff, shifts: [A, M, N, OFF], assignments, leave, period }));
    expect(findings.some((f) => f.ruleCode === "C8")).toBe(false);
  });

  it("has an evaluator for every rule that reports findings", () => {
    expect(Object.keys(RULE_EVALUATORS).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C13", "C14"]);
  });
});
