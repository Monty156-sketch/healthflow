import { describe, expect, it } from "vitest";
import { generate, type GenerateInput } from "../src/engine/generate.js";
import type { EAssignment } from "../src/engine/types.js";
import { A, CYCLES, M, N, OFF, RULES, cycle, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);
const day = (n: number) => period.startDay + n - 1;

function base(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    staff: Array.from({ length: 18 }, (_, i) => person(i + 1)),
    shifts: [{ ...A, minStaff: 3 }, { ...M, minStaff: 2 }, { ...N, minStaff: 2 }, OFF],
    offShiftId: "D/O",
    rules: RULES,
    cycles: CYCLES,
    leave: [],
    holidays: [],
    period,
    weekStartsOn: 1,
    referenceWeeks: 4,
    history: [],
    locked: [],
    ...overrides,
  };
}

describe("generation", () => {
  it("builds a lawful roster with no blank cells", () => {
    const input = base();
    const r = generate(input);
    expect(r.feasible).toBe(true);
    expect(r.unfilled).toEqual([]);
    expect(r.findings.filter((f) => f.severity === "BLOCK")).toEqual([]);
    // Every person has something in every cell.
    for (const s of input.staff) {
      const days = new Set(r.cells.filter((c) => c.staffId === s.id).map((c) => c.day));
      expect(days.size).toBe(30);
    }
    // Each shift has its minimum every day.
    for (let d = 1; d <= 30; d++) {
      const count = (shift: string) => r.cells.filter((c) => c.day === day(d) && c.shiftId === shift).length;
      expect(count("A")).toBeGreaterThanOrEqual(3);
      expect(count("M")).toBeGreaterThanOrEqual(2);
      expect(count("N")).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives the same roster for the same inputs", () => {
    expect(generate(base())).toEqual(generate(base()));
  });

  it("builds visible blocks, not scattered single duties", () => {
    const r = generate(base());
    const runs: number[] = [];
    for (const s of base().staff) {
      const days = r.cells.filter((c) => c.staffId === s.id && c.shiftId !== "D/O").map((c) => c.day).sort((a, b) => a - b);
      let len = 0;
      let prev = -10;
      for (const d of days) {
        if (d === prev + 1) len++;
        else {
          if (len) runs.push(len);
          len = 1;
        }
        prev = d;
      }
      if (len) runs.push(len);
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(2.5);
  });

  it("never gives a night to someone excluded from nights or limited to other shifts", () => {
    const staff = base().staff.map((s, i) => (i === 0 ? { ...s, excludedFromNights: true } : i === 1 ? { ...s, eligibleShiftIds: ["A"] } : s));
    const r = generate(base({ staff }));
    const mine = (id: string) => r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O").map((c) => c.shiftId);
    expect(mine("staff_01")).not.toContain("N");
    expect(new Set(mine("staff_02"))).toEqual(new Set(["A"]));
    expect(r.findings.some((f) => f.ruleCode === "C10")).toBe(false);
  });

  it("respects approved leave and a weekly duty maximum", () => {
    const staff = base().staff.map((s, i) => (i === 2 ? { ...s, maxDutiesPerWeek: 3 } : s));
    const r = generate(base({ staff, leave: [{ staffId: "staff_01", startDay: day(5), endDay: day(9) }] }));
    expect(r.cells.some((c) => c.staffId === "staff_01" && c.day >= day(5) && c.day <= day(9) && c.shiftId !== "D/O")).toBe(false);
    const weekly = new Map<number, number>();
    for (const c of r.cells.filter((c) => c.staffId === "staff_03" && c.shiftId !== "D/O")) {
      const wk = c.day - ((new Date(c.day * 86_400_000).getUTCDay() + 6) % 7); // the Monday of that week
      weekly.set(wk, (weekly.get(wk) ?? 0) + 1);
    }
    expect(Math.max(...weekly.values())).toBeLessThanOrEqual(3);
  });

  it("keeps locked assignments and does not return them", () => {
    const locked: EAssignment[] = [{ staffId: "staff_05", shiftId: "N", day: day(3), locked: true }];
    const r = generate(base({ locked }));
    expect(r.cells.some((c) => c.staffId === "staff_05" && c.day === day(3))).toBe(false);
    expect(r.cells.filter((c) => c.day === day(3) && c.shiftId === "N").length).toBe(1); // the locked one counts toward the two needed
  });

  it("stops and reports the shortfall when no lawful roster is possible", () => {
    const r = generate(base({ staff: base().staff.slice(0, 2) }));
    expect(r.feasible).toBe(false);
    expect(r.cells).toEqual([]);
    expect(r.shortfalls[0]).toMatchObject({ day: day(1), required: 3, available: 2 });
  });
});

describe("run state at the month boundary", () => {
  // Only staff_01 can work: the other two are on leave for the first days.
  const trio = [1, 2, 3].map((n) => person(n));
  const lonely = (history: EAssignment[], locked: EAssignment[], enforcement: "BLOCK" | "PREFER", awayUntil = 3) =>
    base({
      staff: trio,
      shifts: [{ ...A, minStaff: 1 }, OFF],
      cycles: [cycle("r1", "5 days on, 2 off", ["A", "M"], 5, 2, 1, enforcement)],
      leave: [2, 3].map((n) => ({ staffId: `staff_0${n}`, startDay: day(1), endDay: day(awayUntil) })),
      history,
      locked,
    });

  it("a person who ended last month on four day duties starts on run four", () => {
    const history: EAssignment[] = [4, 3, 2, 1].map((back) => ({ staffId: "staff_01", shiftId: "A", day: day(1) - back }));
    const r = generate(lonely(history, [], "BLOCK"));
    const mine = (d: number) => r.cells.find((c) => c.staffId === "staff_01" && c.day === day(d));
    expect(mine(1)?.shiftId).toBe("A"); // the fifth duty
    expect(mine(2)).toMatchObject({ shiftId: "D/O", source: "REST_BLOCK" });
    expect(mine(3)).toMatchObject({ shiftId: "D/O", source: "REST_BLOCK" });
    // With the other two away and the off days mandatory, days 2 and 3 are left unfilled.
    expect(r.unfilled.map((u) => u.day)).toEqual([day(2), day(3)]);
  });

  it("without that history, the same person simply carries on", () => {
    const r = generate(lonely([], [], "BLOCK"));
    expect(r.cells.find((c) => c.staffId === "staff_01" && c.day === day(2))?.shiftId).toBe("A");
  });

  it("three days then three nights trips the catch-all rule at six duties", () => {
    const locked: EAssignment[] = [
      ...[1, 2, 3].map((d) => ({ staffId: "staff_01", shiftId: "A", day: day(d), locked: true })),
      ...[4, 5, 6].map((d) => ({ staffId: "staff_01", shiftId: "N", day: day(d), locked: true })),
    ];
    const input = lonely([], locked, "BLOCK");
    input.leave = [2, 3].map((n) => ({ staffId: `staff_0${n}`, startDay: day(1), endDay: day(10) }));
    input.cycles = [
      cycle("r1", "5 days on, 2 off", ["A", "M"], 5, 2, 2, "BLOCK"),
      cycle("r2", "4 nights on, 3 off", ["N"], 4, 3, 1, "BLOCK"),
      cycle("r3", "6 duties on, 2 off", ["A", "M", "N"], 6, 2, 3, "BLOCK"),
    ];
    input.shifts = [A, N, OFF];
    const r = generate(input);
    const cell = (d: number) => r.cells.find((c) => c.staffId === "staff_01" && c.day === day(d));
    expect(cell(7)).toMatchObject({ shiftId: "D/O", source: "REST_BLOCK" });
    expect(cell(8)).toMatchObject({ shiftId: "D/O", source: "REST_BLOCK" });
    expect(cell(9)).toMatchObject({ shiftId: "D/O", source: "GENERATED" }); // the block is over
  });

  it("Prefer breaks the pattern rather than leave coverage short", () => {
    const history: EAssignment[] = [4, 3, 2, 1].map((back) => ({ staffId: "staff_01", shiftId: "A", day: day(1) - back }));
    const r = generate(lonely(history, [], "PREFER", 2));
    expect(r.unfilled).toEqual([]);
    expect(r.cells.find((c) => c.staffId === "staff_01" && c.day === day(2))?.shiftId).toBe("A");
  });
});

describe("speed", () => {
  it("builds a month for 60 staff well inside 60 seconds", () => {
    const staff = Array.from({ length: 60 }, (_, i) => person(i + 1));
    const started = Date.now();
    const r = generate(base({ staff, shifts: [{ ...A, minStaff: 12 }, { ...M, minStaff: 9 }, { ...N, minStaff: 8 }, OFF], period: periodFrom(2026, 10, 1, 31) }));
    const seconds = (Date.now() - started) / 1000;
    console.log(`60 staff, 31 days: ${seconds.toFixed(1)}s, ${r.stats.duties} duties, ${r.stats.unfilled} unfilled`);
    expect(r.feasible).toBe(true);
    expect(seconds).toBeLessThan(30);
  });
});

describe("what follows a rest, and the order inside a block", () => {
  const withOrder = (enforcement: "BLOCK" | "PREFER", order = true) => [
    { ...cycle("r2", "2 nights on, 2 off", ["N"], 2, 2, 1, enforcement), nextShiftAfterRestId: order ? "M" : null },
    { ...cycle("r1", "4 days on, 1 off", ["A", "M"], 4, 1, 2, "PREFER"), blockShiftPatternIds: order ? ["M", "A"] : [] },
    cycle("r3", "6 duties on, 2 off", ["A", "M", "N"], 6, 2, 3),
  ];
  const sequence = (r: ReturnType<typeof generate>, id: string) =>
    Array.from({ length: 30 }, (_, i) => r.cells.find((c) => c.staffId === id && c.day === day(i + 1))?.shiftId ?? "?");
  const ids = base().staff.map((s) => s.id);

  it("brings people back from a night rest on the shift the rule names", () => {
    const r = generate(base({ cycles: withOrder("BLOCK") }));
    let seen = 0;
    for (const id of ids) {
      const seq = sequence(r, id);
      for (let i = 2; i < seq.length; i++) {
        if (seq[i - 2] !== "N" || seq[i - 1] !== "N" || seq[i] !== "D/O") continue;
        let j = i;
        while (j < seq.length && seq[j] === "D/O") j++;
        if (j < seq.length && j - i >= 2) {
          seen++;
          expect(seq[j], `${id} came back from nights on ${seq[j]}`).toBe("M");
        }
      }
    }
    expect(seen).toBeGreaterThan(3);
  });

  it("alternates Afternoon and Morning inside a day block more often than without the order", () => {
    const share = (order: boolean) => {
      const r = generate(base({ cycles: withOrder("PREFER", order) }));
      let pairs = 0;
      let alternating = 0;
      for (const id of ids) {
        const seq = sequence(r, id);
        for (let i = 1; i < seq.length; i++) {
          const day2 = (x: string) => x === "A" || x === "M";
          if (day2(seq[i - 1]) && day2(seq[i])) {
            pairs++;
            if (seq[i - 1] !== seq[i]) alternating++;
          }
        }
      }
      return alternating / pairs;
    };
    expect(share(true)).toBeGreaterThan(share(false) + 0.1);
  });

  it("does not make the spread of duties worse", () => {
    const spread = (order: boolean) => {
      const r = generate(base({ cycles: withOrder("PREFER", order) }));
      const duties = ids.map((id) => sequence(r, id).filter((x) => x !== "D/O" && x !== "?").length);
      return Math.max(...duties) - Math.min(...duties);
    };
    expect(spread(true)).toBeLessThanOrEqual(spread(false) + 2);
  });

  it("leaves a slot unfilled rather than break a Block return shift", () => {
    const history: EAssignment[] = [2, 1].map((back) => ({ staffId: "staff_01", shiftId: "N", day: day(1) - back }));
    const input = base({
      staff: [1, 2, 3].map((n) => person(n)),
      shifts: [{ ...A, minStaff: 1 }, { ...M, minStaff: 0 }, { ...N, minStaff: 0 }, OFF],
      cycles: [{ ...cycle("r2", "2 nights on, 2 off", ["N"], 2, 2, 1, "BLOCK"), nextShiftAfterRestId: "M" }],
      leave: [2, 3].map((n) => ({ staffId: `staff_0${n}`, startDay: day(1), endDay: day(10) })),
      history,
    });
    const r = generate(input);
    const mine = (d: number) => r.cells.find((c) => c.staffId === "staff_01" && c.day === day(d))?.shiftId;
    expect([1, 2].map(mine)).toEqual(["D/O", "D/O"]);
    expect(mine(3)).not.toBe("A");
    expect(r.unfilled.some((u) => u.day === day(3))).toBe(true);
  });
});
