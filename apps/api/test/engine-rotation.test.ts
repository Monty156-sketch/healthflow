import { describe, expect, it } from "vitest";
import { generate, type GenerateInput } from "../src/engine/generate.js";
import type { EAssignment, ERotation } from "../src/engine/types.js";
import { A, M, N, OFF, RULES, cycle, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);

// The two cycles the facility keeps: 4 nights, 3 off, back on afternoon; 4 days alternating, 1 off.
const CYCLES = [
  { ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" },
  { ...cycle("d", "4 days on, 1 off", ["A", "M"], 4, 1, 2), blockShiftPatternIds: ["M", "A"] },
];
const ROTATION: ERotation = { id: "r", name: "Standard", sequenceShiftIds: ["N", "M", "A"], cadreIds: [], departmentIds: [], enforcement: "PREFER" };

function base(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    staff: Array.from({ length: 18 }, (_, i) => person(i + 1)),
    shifts: [{ ...A, minStaff: 3 }, { ...M, minStaff: 2 }, { ...N, minStaff: 2 }, OFF],
    offShiftId: "D/O",
    rules: RULES,
    cycles: CYCLES,
    rotations: [ROTATION],
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

const duties = (r: ReturnType<typeof generate>, id: string) => r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O").sort((a, b) => a.day - b.day);

describe("rotation order", () => {
  it("does not make the spread of duties worse", () => {
    const spread = (input: GenerateInput) => {
      const r = generate(input);
      expect(r.feasible).toBe(true);
      const counts = input.staff.map((s) => duties(r, s.id).length);
      return Math.max(...counts) - Math.min(...counts);
    };
    const withRotation = spread(base());
    const without = spread(base({ rotations: [] }));
    console.log(`spread with rotation ${withRotation}, without ${without}`);
    expect(withRotation).toBeLessThanOrEqual(without + 1);
    // 18 identical people on these two cycles end within a handful of duties of each other
    expect(withRotation).toBeLessThanOrEqual(6);
  });

  it("returns from a rest in the facility's order more often than without a rotation", () => {
    const seq = ROTATION.sequenceShiftIds;
    const outOfOrder = (input: GenerateInput) => {
      const r = generate(input);
      let n = 0;
      for (const s of input.staff) {
        const list = duties(r, s.id);
        for (let i = 1; i < list.length; i++) {
          if (list[i].day === list[i - 1].day + 1) continue;
          if ((seq.indexOf(list[i].shiftId) - seq.indexOf(list[i - 1].shiftId) + 3) % 3 >= 2) n++;
        }
      }
      return n;
    };
    expect(outOfOrder(base())).toBeLessThan(outOfOrder(base({ rotations: [] })));
  });

  it("with Block, a rest is never followed by a shift two places out of the order", () => {
    const seq = ROTATION.sequenceShiftIds;
    const input = base({ rotations: [{ ...ROTATION, enforcement: "BLOCK" }] });
    const r = generate(input);
    for (const s of input.staff) {
      const list = duties(r, s.id);
      for (let i = 1; i < list.length; i++) {
        if (list[i].day === list[i - 1].day + 1) continue;
        expect((seq.indexOf(list[i].shiftId) - seq.indexOf(list[i - 1].shiftId) + 3) % 3).toBeLessThan(2);
      }
    }
  });
});

describe("carry-over from earlier months", () => {
  it("gives fewer duties to the people who did the most before", () => {
    const staff = Array.from({ length: 12 }, (_, i) => person(i + 1));
    // The first three worked 20 extra days in the three months before; the rest worked 8.
    const history: EAssignment[] = [];
    staff.forEach((s, i) => {
      const n = i < 3 ? 28 : 8;
      for (let d = 1; d <= n; d++) history.push({ staffId: s.id, shiftId: "A", day: period.startDay - 2 - d * 3 });
    });
    const input = base({ staff, history, rotations: [], shifts: [{ ...A, minStaff: 3 }, { ...M, minStaff: 2 }, OFF] });
    const r = generate(input);
    expect(r.feasible).toBe(true);
    expect(r.stats.carried).toBeGreaterThan(0);
    const mean = (ids: string[]) => ids.reduce((n, id) => n + duties(r, id).length, 0) / ids.length;
    const heavy = staff.slice(0, 3).map((s) => s.id);
    const light = staff.slice(3).map((s) => s.id);
    expect(mean(heavy)).toBeLessThan(mean(light));
  });

  it("does nothing when there is no history", () => {
    expect(generate(base({ rotations: [] })).stats.carried).toBe(0);
  });
});

describe("generating again", () => {
  const key = (r: ReturnType<typeof generate>) => r.cells.map((c) => `${c.staffId}:${c.day}:${c.shiftId}`).sort().join("|");

  it("gives the same roster for the same variation", () => {
    expect(key(generate(base({ variation: 7 })))).toBe(key(generate(base({ variation: 7 }))));
  });

  it("gives a different lawful roster for another variation, still following the cycles", () => {
    const a = generate(base());
    const b = generate(base({ variation: 12345 }));
    expect(b.feasible).toBe(true);
    expect(key(b)).not.toBe(key(a));
    // No run of nights longer than four in either, so the cycle rule still holds.
    for (const r of [a, b]) {
      for (const s of base().staff) {
        let run = 0;
        for (let d = period.startDay; d <= period.endDay; d++) {
          run = r.cells.some((c) => c.staffId === s.id && c.day === d && c.shiftId === "N") ? run + 1 : 0;
          expect(run).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
