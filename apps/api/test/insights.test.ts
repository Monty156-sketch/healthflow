import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { rosterInsights } from "../src/engine/insights.js";
import { A, M, N, OFF, CYCLES, RULES, person, periodFrom } from "./engineKit.js";

const names: Record<string, string> = { mid: "Midwife", rgn: "Registered General Nurse", en: "Enrolled Nurse" };
const crew = (spec: [string, number][], extra: Record<string, object> = {}) => {
  let n = 0;
  return spec.flatMap(([cadre, count]) => Array.from({ length: count }, () => { n += 1; return person(n, { cadreId: cadre, ...(extra[`s${n}`] ?? {}) }); }));
};
const shifts = [{ ...A, minStaff: 3, minByCadre: { mid: 1 } }, { ...M, minStaff: 3, minByCadre: { mid: 1 } }, { ...N, minStaff: 3, minByCadre: { mid: 1 } }, OFF];
const period = periodFrom(2026, 10, 1, 31);
const build = (staff: ReturnType<typeof crew>, leave: { staffId: string; startDay: number; endDay: number }[] = []) => {
  const r = generate({ staff, shifts, offShiftId: "D/O", rules: RULES, cycles: CYCLES, leave, holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [] });
  const assignments = r.cells.map((c) => ({ staffId: c.staffId, shiftId: c.shiftId, day: c.day }));
  return { r, view: rosterInsights({ staff, shifts, cycles: CYCLES, leave, holidays: [], period, assignments, cadreNames: names }) };
};

describe("roster insights", () => {
  it("names the cadre that is short and says how many more it needs", () => {
    const { r, view } = build(crew([["mid", 3], ["rgn", 8], ["en", 7]]));
    expect(r.unfilled.length).toBeGreaterThan(0);
    expect(view.advice).toHaveLength(1);
    const a = view.advice[0];
    expect(a.cadreName).toBe("Midwife");
    expect(a.shortDuties).toBe(r.unfilled.length);
    expect(a.moreStaff).toBeGreaterThanOrEqual(1);
    expect(a.headline).toContain("Midwife: short by");
    expect(a.options[0]).toMatch(/^Add at least \d+ more/);
  });

  it("gives no advice when every cadre minimum is met", () => {
    const { r, view } = build(crew([["mid", 8], ["rgn", 8]]));
    expect(r.unfilled).toHaveLength(0);
    expect(view.advice).toEqual([]);
  });

  it("counts duties, nights, weekends and hours per person, and flags a light load that leave explains", () => {
    const staff = crew([["mid", 6], ["rgn", 6], ["en", 4]]);
    const away = staff[7].id;
    const { view } = build(staff, [{ staffId: away, startDay: period.startDay, endDay: period.startDay + 19 }]);
    const row = view.workload.find((w) => w.staffId === away)!;
    expect(row.leaveDays).toBe(20);
    expect(row.against).toBe("below");
    expect(row.note).toContain("approved leave for 20 days");
    for (const w of view.workload) expect(w.nights).toBeLessThanOrEqual(w.duties);
    const total = view.workload.reduce((n, w) => n + w.duties, 0);
    const cadreTotal = view.cadres.reduce((n, c) => n + c.averageDuties * c.people, 0);
    expect(Math.abs(total - cadreTotal)).toBeLessThan(view.cadres.length);
  });

  it("says why a person with no nights has a different load", () => {
    const staff = crew([["mid", 6], ["rgn", 6], ["en", 4]], { s14: { excludedFromNights: true } });
    const { view } = build(staff);
    expect(view.workload.find((w) => w.staffId === staff[13].id)!.restriction).toBe("No night duties");
  });
});
