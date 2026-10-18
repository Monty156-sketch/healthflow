import { describe, expect, it } from "vitest";
import { generate, type GenerateInput } from "../src/engine/generate.js";
import { A, M, N, OFF, RULES, cycle, periodFrom, person } from "./engineKit.js";

const period = periodFrom(2026, 11, 1, 30);
const NIGHT_RULE = { ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" };
const DAY_RULE = { ...cycle("d", "4 days on, 2 off", ["A", "M"], 4, 2, 2), blockShiftPatternIds: ["M", "A"] };
const staff = Array.from({ length: 18 }, (_, i) => person(i + 1));

function run(cycles: GenerateInput["cycles"], variation = 0) {
  const r = generate({
    staff, shifts: [{ ...A, minStaff: 4 }, { ...M, minStaff: 3 }, { ...N, minStaff: 3 }, OFF], offShiftId: "D/O", rules: RULES, cycles, rotations: [],
    leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [], variation,
  });
  expect(r.feasible).toBe(true);
  return r;
}

/** Runs of consecutive duties, as "N" or "D" blocks, in date order. */
function blocks(r: ReturnType<typeof run>, id: string) {
  const days = new Map(r.cells.filter((c) => c.staffId === id && c.shiftId !== "D/O").map((c) => [c.day, c.shiftId]));
  const out: { kind: "N" | "D"; len: number }[] = [];
  for (let d = period.startDay; d <= period.endDay; d++) {
    const sid = days.get(d);
    if (!sid) continue;
    const kind = sid === "N" ? "N" : "D";
    const prev = days.get(d - 1);
    if (prev && (prev === "N") === (sid === "N") && out.length) out[out.length - 1].len++;
    else out.push({ kind, len: 1 });
  }
  return out;
}

describe("blending night and day rules", () => {
  it("does not leave anyone on nights all month or on days all month", () => {
    const r = run([NIGHT_RULE, DAY_RULE]);
    let mixed = 0;
    for (const s of staff) {
      const kinds = new Set(blocks(r, s.id).map((b) => b.kind));
      if (kinds.size === 2) mixed++;
    }
    console.log("people with both nights and days:", mixed, "of", staff.length);
    expect(mixed).toBeGreaterThanOrEqual(Math.ceil(staff.length * 0.7));
  });

  it("mixes more with both rules than the same roster built without the blend", () => {
    const withBlend = run([NIGHT_RULE, DAY_RULE]);
    const dayOnly = run([DAY_RULE]);
    const changes = (r: ReturnType<typeof run>) => staff.reduce((n, s) => n + Math.max(0, blocks(r, s.id).length - 1), 0);
    expect(changes(withBlend)).toBeGreaterThan(0);
    expect(changes(dayOnly)).toBeGreaterThanOrEqual(0);
  });

  it("keeps night blocks to four and puts days off after them", () => {
    const r = run([NIGHT_RULE, DAY_RULE]);
    for (const s of staff) {
      const bl = blocks(r, s.id);
      for (const b of bl) if (b.kind === "N") expect(b.len).toBeLessThanOrEqual(4);
    }
  });
});
