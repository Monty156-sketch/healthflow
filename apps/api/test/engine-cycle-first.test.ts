import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { A, M, N, OFF, RULES, cycle, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);
const cycles = (enforcement: "BLOCK" | "PREFER") => [cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1, enforcement), cycle("d", "4 days on, 2 off", ["A", "M"], 4, 2, 2, enforcement)];
const rotations = [{ id: "r", name: "Afternoon, Night, Morning", sequenceShiftIds: ["A", "N", "M"], cadreIds: [], departmentIds: [], enforcement: "BLOCK" as const }];
const base = (extra: object = {}) => ({
  staff: Array.from({ length: 6 }, (_, i) => person(i + 1)),
  shifts: [{ ...A, minStaff: 2 }, { ...M, minStaff: 1 }, { ...N, minStaff: 1 }, OFF],
  offShiftId: "D/O",
  rules: RULES,
  cycles: cycles("BLOCK"),
  rotations,
  leave: [],
  holidays: [],
  period,
  weekStartsOn: 1,
  referenceWeeks: 4,
  history: [],
  locked: [],
  ...extra,
});

/** A person's month as blocks: [shift, length] for work and ["-", length] for days off. */
function blocks(r: ReturnType<typeof generate>, id: string) {
  const out: [string, number][] = [];
  for (let d = period.startDay; d <= period.endDay; d++) {
    const sid = r.cells.find((c) => c.staffId === id && c.day === d)?.shiftId ?? "D/O";
    const k = sid === "D/O" ? "-" : sid;
    if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1]++;
    else out.push([k, 1]);
  }
  return out;
}

describe("cycle first", () => {
  it("builds every month from the cycle rules and the rotation, and never bends a cycle", () => {
    const r = generate(base());
    expect(r.feasible).toBe(true);
    const order = ["A", "N", "M"];
    for (let i = 1; i <= 6; i++) {
      const bl = blocks(r, `staff_0${i}`);
      // Complete blocks are 4 long; days off after days are 2, after nights 3. The first and last block may be cut by the month's edges.
      bl.forEach(([k, len], at) => {
        const edge = at === 0 || at === bl.length - 1;
        if (k === "-") {
          if (edge) return;
          expect(len, `${i} rest after ${bl[at - 1][0]}`).toBe(bl[at - 1][0] === "N" ? 3 : 2);
        } else if (!edge) expect(len, `${i} block of ${k}`).toBe(4);
      });
      // The shift after each rest is the next one in the rotation.
      const work = bl.filter(([k]) => k !== "-");
      for (let w = 1; w < work.length; w++) expect(order[(order.indexOf(work[w - 1][0]) + 1) % 3], `${i} order`).toBe(work[w][0]);
    }
  });

  it("leaves a gap in the open rather than break a cycle when the cycles cannot cover a minimum", () => {
    const r = generate(base());
    // Six people rotating through three shifts cannot give Afternoon its two every day; that shows as gaps, only there.
    expect(r.unfilled.length).toBeGreaterThan(0);
    expect(r.unfilled.every((u) => u.shiftId === "A")).toBe(true);
  });

  it("shares weekend duties between people", () => {
    const r = generate(base());
    const special = (id: string) => r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O" && [0, 6].includes(new Date(c.day * 86400000).getUTCDay())).length;
    const counts = [1, 2, 3, 4, 5, 6].map((i) => special(`staff_0${i}`));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(4);
  });

  it("carries on from last month: someone who ended on four days starts with their two days off", () => {
    const history = [4, 3, 2, 1].map((back) => ({ staffId: "staff_01", shiftId: "A", day: period.startDay - back }));
    const r = generate(base({ history }));
    const first = blocks(r, "staff_01");
    expect(first[0]).toEqual(["-", 2]);
    expect(first[1][0]).toBe("N"); // Afternoon is followed by Night in the rotation
  });

  it("skips leave without breaking the cycle either side of it", () => {
    const r = generate(base({ leave: [{ staffId: "staff_02", startDay: period.startDay + 8, endDay: period.startDay + 14 }] }));
    for (let d = period.startDay + 8; d <= period.startDay + 14; d++) expect(r.cells.find((c) => c.staffId === "staff_02" && c.day === d)?.shiftId).toBe("D/O");
  });

  it("leaves Prefer cycles to the day-by-day pass, which may bend them to cover", () => {
    const r = generate(base({ cycles: cycles("PREFER") }));
    expect(r.unfilled.length).toBeLessThan(generate(base()).unfilled.length);
  });
});
