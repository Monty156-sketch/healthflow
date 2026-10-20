import { describe, expect, it } from "vitest";
import { generate, type GenerateInput } from "../src/engine/generate.js";
import { evaluateWeekendsOff } from "../src/engine/evaluators.js";
import { A, M, N, OFF, RULES, cycle, person, periodFrom } from "./engineKit.js";
import type { EStaff } from "../src/engine/types.js";

const period = periodFrom(2026, 11, 1, 30);
const day = (n: number) => period.startDay + n - 1;
const cycles = [{ ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" }, { ...cycle("d", "4 days on, 1 off", ["A", "M"], 4, 1, 2), blockShiftPatternIds: ["M", "A"] }];
const rules = RULES.map((r) => (r.code === "C8" ? { ...r, threshold: 4 } : r));
const team = (n = 18, extra: (i: number) => Partial<EStaff> = () => ({})) => Array.from({ length: n }, (_, i) => person(i + 1, extra(i)));
const base = (o: Partial<GenerateInput> = {}): GenerateInput => ({
  staff: team(), shifts: [{ ...A, minStaff: 3 }, { ...M, minStaff: 2 }, { ...N, minStaff: 2 }, OFF], offShiftId: "D/O", rules, cycles,
  leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [], ...o,
});
const mine = (r: ReturnType<typeof generate>, id: string) => r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O");

describe("someone who can lead every shift", () => {
  // Five of eighteen can lead; every shift asks for one.
  const staff = team(18, (i) => ({ canLead: i < 5 }));
  const shifts = [{ ...A, minStaff: 3, minLeads: 1 }, { ...M, minStaff: 2, minLeads: 1 }, { ...N, minStaff: 2, minLeads: 1 }, OFF];
  const r = generate(base({ staff, shifts }));

  it("puts a lead on most shifts and says plainly where there is none", () => {
    const leads = new Set(staff.filter((s) => s.canLead).map((s) => s.id));
    let led = 0;
    let total = 0;
    for (let d = 1; d <= 30; d++) for (const x of ["A", "M", "N"]) {
      const here = r.cells.filter((c) => c.day === day(d) && c.shiftId === x);
      if (!here.length) continue;
      total++;
      if (here.some((c) => leads.has(c.staffId))) led++;
    }
    expect(led / total).toBeGreaterThan(0.8);
    const missing = r.findings.filter((f) => f.ruleCode === "C11" && f.message.includes("lead"));
    expect(missing.length).toBe(total - led);
  });

  it("still staffs a shift with no lead available rather than leave it empty", () => {
    expect(r.unfilled).toEqual([]);
  });
});

describe("a person's own limits", () => {
  it("never gives more nights or hours than the person's monthly limit", () => {
    const staff = team(18, (i) => (i === 0 ? { maxNightsPerMonth: 4 } : i === 1 ? { maxHoursPerMonth: 60 } : {}));
    const r = generate(base({ staff }));
    expect(mine(r, "staff_01").filter((c) => c.shiftId === "N").length).toBeLessThanOrEqual(4);
    expect(mine(r, "staff_02").reduce((t, c) => t + (c.shiftId === "N" ? 12 : 6), 0)).toBeLessThanOrEqual(60);
  });

  it("gives no nights during a no-nights period, and nights again after it", () => {
    const staff = team(18, (i) => (i === 0 ? { noNights: [{ startDay: day(1), endDay: day(20) }] } : {}));
    const r = generate(base({ staff }));
    expect(mine(r, "staff_01").filter((c) => c.shiftId === "N" && c.day <= day(20))).toEqual([]);
  });
});

describe("days people ask to have off", () => {
  it("keeps an approved day free, and avoids a pending one where it can", () => {
    const daysOff = [
      ...[3, 4, 5].map((d) => ({ staffId: "staff_01", day: day(d), approved: true })),
      ...[10, 11, 12, 13].map((d) => ({ staffId: "staff_02", day: day(d), approved: false })),
    ];
    const r = generate(base({ daysOff }));
    const on = (id: string, d: number) => mine(r, id).some((c) => c.day === day(d));
    expect([3, 4, 5].some((d) => on("staff_01", d))).toBe(false);
    expect([10, 11, 12, 13].filter((d) => on("staff_02", d)).length).toBeLessThanOrEqual(1);
    expect(r.unfilled).toEqual([]);
  });
});

describe("weekends and days off in the month", () => {
  const withRules = (c13: number, c14: number) => [...rules, { code: "C13", threshold: c13, severity: "WARN" as const }, { code: "C14", threshold: c14, severity: "WARN" as const }];
  it("gives everyone at least one full weekend off and at least the days off asked for", () => {
    const r = generate(base({ rules: withRules(1, 9) }));
    expect(r.unfilled).toEqual([]);
    expect(r.findings.filter((f) => f.ruleCode === "C14")).toEqual([]);
    expect(r.findings.filter((f) => f.ruleCode === "C13").length).toBeLessThanOrEqual(1);
    for (const s of base().staff) expect(30 - mine(r, s.id).length).toBeGreaterThanOrEqual(9);
  });

  it("reports anyone left without a weekend off", () => {
    const r = generate(base({ rules: withRules(5, 0) }));
    expect(r.findings.some((f) => f.ruleCode === "C13" && f.message.includes("the facility asks for at least 5"))).toBe(true);
  });
});

describe("full weekends off on Block", () => {
  it("leaves no one without a full weekend off when the rule blocks", () => {
    const r = generate(base({ staff: team(14), rules: [...rules, { code: "C13", threshold: 1, severity: "BLOCK" as const }] }));
    expect(r.findings.filter((f) => f.ruleCode === "C13")).toEqual([]);
  });

  it("does not count a weekend as free after a Friday night", () => {
    let fri = period.startDay;
    while (new Date(fri * 86_400_000).getUTCDay() !== 5) fri++;
    const s = person(1);
    const ctx = { staff: [s], shifts: [A, M, N, OFF], assignments: [] as { staffId: string; shiftId: string; day: number }[], leave: [], period, weekStartsOn: 1, referenceWeeks: 4 };
    // Work every Saturday except one, and a night on the Friday before that one.
    for (let d = period.startDay; d <= period.endDay; d++) if (new Date(d * 86_400_000).getUTCDay() === 6 && d !== fri + 1) ctx.assignments.push({ staffId: s.id, shiftId: "A", day: d });
    const rule = { code: "C13", threshold: 1, severity: "WARN" as const };
    expect(evaluateWeekendsOff(rule, ctx)).toEqual([]);
    // A new context: the evaluators cache their index per context object.
    const withNight = { ...ctx, assignments: [...ctx.assignments, { staffId: s.id, shiftId: "N", day: fri }] };
    expect(evaluateWeekendsOff(rule, withNight)).toHaveLength(1);
  });
});
