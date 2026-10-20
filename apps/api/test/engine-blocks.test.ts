import { describe, expect, it } from "vitest";
import { generate } from "../src/engine/generate.js";
import { CYCLES, OFF, RULES, cycle, person, periodFrom, shift } from "./engineKit.js";
import { demandOn } from "../src/engine/demand.js";
import { weekdayOf } from "../src/engine/time.js";

// Shifts close to a Ghanaian ward: a 7-hour morning and afternoon, a 10-hour night.
const A = shift("A", "Morning", 7 * 60, 7);
const M = shift("M", "Afternoon", 14 * 60, 7, { sortOrder: 1 });
const N = shift("N", "Night", 21 * 60, 10, { isOvernight: true, sortOrder: 2 });
const period = periodFrom(2026, 10, 1, 31);
const rules = RULES.map((r) => (r.code === "C8" ? { ...r, threshold: 4 } : r));
const input = (people: number) => ({
  staff: Array.from({ length: people }, (_, i) => person(i + 1)),
  shifts: [{ ...A, minStaff: 4 }, { ...M, minStaff: 3 }, { ...N, minStaff: 3 }, OFF],
  offShiftId: "D/O", rules, cycles: CYCLES, leave: [], holidays: [], period, weekStartsOn: 1, referenceWeeks: 4, history: [], locked: [],
});
const weekends = (r: ReturnType<typeof generate>, people: number) =>
  Array.from({ length: people }, (_, i) => r.cells.filter((c) => c.staffId === person(i + 1).id && c.shiftId !== "D/O" && (weekdayOf(c.day) === 0 || weekdayOf(c.day) === 6)).length);

describe("planned blocks", () => {
  for (const people of [18, 22]) {
    it(`with ${people} staff, works in blocks: far fewer stray days and night/day switches, no gap, no broken rule`, () => {
      const planned = generate(input(people));
      const plain = generate({ ...input(people), blocks: false });
      expect(planned.unfilled).toHaveLength(0);
      expect(planned.findings.filter((f) => f.severity === "BLOCK")).toEqual([]);
      expect(planned.stats.scatter).toBeLessThan(plain.stats.scatter * 0.6);
    });
  }

  it("shares weekends at least as evenly as filling day by day", () => {
    const w = weekends(generate(input(18)), 18);
    const p = weekends(generate({ ...input(18), blocks: false }), 18);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(Math.max(...p) - Math.min(...p) + 2);
  });

  it("falls back to day-by-day filling when that leaves fewer gaps", () => {
    const tight = input(14);
    const best = generate(tight);
    const plain = generate({ ...tight, blocks: false });
    expect(best.unfilled.length).toBeLessThanOrEqual(plain.unfilled.length);
  });

  it("gives the same roster for the same inputs", () => {
    expect(JSON.stringify(generate(input(18)).cells)).toBe(JSON.stringify(generate(input(18)).cells));
  });
});

describe("weekend and public-holiday minimums", () => {
  const sat = (() => { let d = period.startDay; while (weekdayOf(d) !== 6) d++; return d; })();
  const holiday = sat + 3; // a Tuesday
  const shifts = [{ ...A, minStaff: 4, weekendMinStaff: 2, holidayMinStaff: 1 }, { ...M, minStaff: 3, weekendMinStaff: 2 }, { ...N, minStaff: 3 }, OFF];
  const r = generate({ ...input(18), shifts, holidays: [holiday] });
  const on = (day: number, id: string) => r.cells.filter((c) => c.day === day && c.shiftId === id).length;

  it("reads the right number for each kind of day", () => {
    expect(demandOn(shifts[0], sat, [holiday]).minStaff).toBe(2);
    expect(demandOn(shifts[0], holiday, [holiday]).minStaff).toBe(1);
    expect(demandOn(shifts[1], holiday, [holiday]).minStaff).toBe(2); // no holiday number: the weekend one
    expect(demandOn(shifts[2], sat, [holiday]).minStaff).toBe(3); // no weekend number: the weekday one
    expect(demandOn(shifts[0], sat + 2, [holiday]).minStaff).toBe(4);
  });

  it("staffs every day to its own minimum and reports no shortfall", () => {
    expect(r.unfilled).toEqual([]);
    expect(r.findings.filter((f) => f.ruleCode === "C11")).toEqual([]);
    expect(on(sat, "A")).toBeGreaterThanOrEqual(2);
    expect(on(holiday, "A")).toBeGreaterThanOrEqual(1);
    expect(on(sat + 2, "A")).toBeGreaterThanOrEqual(4);
  });

  it("asks fewer people to work weekends and holidays when the minimum is lower", () => {
    const flat = generate(input(18));
    const weekendDuties = (x: ReturnType<typeof generate>) => x.cells.filter((c) => c.shiftId === "A" && (weekdayOf(c.day) === 0 || weekdayOf(c.day) === 6)).length;
    expect(weekendDuties(r)).toBeLessThan(weekendDuties(flat));
  });
});

describe("public holidays shared over the year", () => {
  const first = period.startDay + 4;
  const holidays = [first, first + 13];
  // Half the team worked three holidays each in the last year; the other half none.
  const holidayWorked = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [person(i + 1).id, i < 9 ? 3 : 0]));
  // A holiday needs one person on each shift, so six holiday duties in all: the rested half can take every one.
  const shifts = [{ ...A, minStaff: 4, holidayMinStaff: 1 }, { ...M, minStaff: 3, holidayMinStaff: 1 }, { ...N, minStaff: 3, holidayMinStaff: 1 }, OFF];
  const r = generate({ ...input(18), shifts, holidays, holidayWorked });

  it("gives this year's holidays to the people who have worked fewer", () => {
    const onHoliday = r.cells.filter((c) => holidays.includes(c.day) && c.shiftId !== "D/O");
    const fromRested = onHoliday.filter((c) => Number(c.staffId.slice(-2)) > 9).length;
    expect(fromRested / onHoliday.length).toBeGreaterThanOrEqual(2 / 3);
  });

  it("gives nobody both holidays when others have none this month", () => {
    const both = input(18).staff.filter((s) => holidays.every((d) => r.cells.some((c) => c.staffId === s.id && c.day === d && c.shiftId !== "D/O")));
    expect(both).toEqual([]);
  });
});

describe("the standard cycles, as a Ghanaian ward sets them", () => {
  // Morning 08:00 to 14:00, afternoon 14:00 to 20:00, night 20:00 to 08:00; 4 nights on, 3 off, back on afternoon; 4 days on, 1 off.
  const A6 = shift("A", "Morning", 8 * 60, 6);
  const M6 = shift("M", "Afternoon", 14 * 60, 6, { sortOrder: 1 });
  const N12 = shift("N", "Night", 20 * 60, 12, { isOvernight: true, sortOrder: 2 });
  const cycles = [{ ...cycle("n", "4 nights on, 3 off", ["N"], 4, 3, 1), nextShiftAfterRestId: "M" }, { ...cycle("d", "4 days on, 1 off", ["A", "M"], 4, 1, 2), blockShiftPatternIds: ["M", "A"] }];
  const staff = Array.from({ length: 18 }, (_, i) => person(i + 1));
  const r = generate({ ...input(18), staff, shifts: [{ ...A6, minStaff: 4 }, { ...M6, minStaff: 3 }, { ...N12, minStaff: 3 }, OFF], cycles });

  it("works nights in blocks of four with at least three days off after, not threes and twos", () => {
    const blocks: number[] = [];
    let restAfter = 0;
    let rested = 0;
    for (const s of staff) {
      const night = (d: number) => r.cells.some((c) => c.staffId === s.id && c.day === d && c.shiftId === "N");
      const any = (d: number) => r.cells.some((c) => c.staffId === s.id && c.day === d && c.shiftId !== "D/O");
      for (let d = period.startDay; d <= period.endDay; d++) {
        if (!night(d) || night(d - 1)) continue;
        let e = d;
        while (night(e + 1)) e++;
        if (d > period.startDay && e < period.endDay) blocks.push(e - d + 1); // whole blocks inside the month
        if (e + 3 <= period.endDay) { restAfter++; if (!any(e + 1) && !any(e + 2) && !any(e + 3)) rested++; }
      }
    }
    expect(blocks.filter((b) => b === 4).length / blocks.length).toBeGreaterThanOrEqual(0.6);
    expect(rested).toBe(restAfter);
    expect(r.unfilled).toEqual([]);
    expect(r.findings.filter((f) => f.severity === "BLOCK" && f.ruleCode !== "C11")).toEqual([]);
  });

  it("works days in blocks, with few stray days", () => {
    expect(r.stats.scatter).toBeLessThan(generate({ ...input(18), staff, shifts: [{ ...A6, minStaff: 4 }, { ...M6, minStaff: 3 }, { ...N12, minStaff: 3 }, OFF], cycles, blocks: false }).stats.scatter * 0.7);
  });
});
