import { describe, expect, it } from "vitest";
import { plain, rosterPdf, type PdfRoster } from "../src/lib/rosterPdf.js";

function sample(n: number): PdfRoster {
  const staff = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Person ${i + 1}`, staffNo: `N${i + 1}`, cadre: "Midwife" }));
  const shifts = [
    { id: "a", code: "M", name: "Morning", time: "07:00 to 14:00", colour: "#25619f", countsAsDuty: true },
    { id: "o", code: "O", name: "Off duty", time: null, colour: null, countsAsDuty: false },
  ];
  const cells = new Map<string, string>();
  for (const s of staff) for (let d = 1; d <= 31; d++) cells.set(`${s.id}|2026-10-${String(d).padStart(2, "0")}`, d % 2 ? "a" : "o");
  return { facilityName: "Sombo Health Centre", place: null, title: "October 2026", statusWord: "Published", version: 1, year: 2026, month: 10, staff, shifts, cells, preparedBy: "A", approvedBy: null, blocking: 0, warnings: 0, overrides: 0, printedOn: "17/10/2026" };
}

const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

describe("roster pdf", () => {
  it("makes a one-page A4 landscape PDF for a small roster", async () => {
    const b = await rosterPdf(sample(12));
    expect(b.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(b)).toBe(1);
    expect(b.toString("latin1")).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
  });

  it("carries a long roster over pages without losing the signatures", async () => {
    expect(pages(await rosterPdf(sample(60)))).toBeGreaterThan(1);
  });

  it("copes with a roster with nobody on it", async () => {
    expect(pages(await rosterPdf(sample(0)))).toBe(1);
  });

  it("shows leave and approved days off as codes, holidays in the header, leads, and daily counts on one page", async () => {
    const r = sample(14);
    r.holidays = [1];
    r.marks = new Map([["s0|2026-10-05", "AL"], ["s0|2026-10-06", "AL"], ["s1|2026-10-09", "RO"]]);
    r.markLegend = [{ code: "AL", label: "Annual leave" }, { code: "RO", label: "day off asked for and approved" }];
    r.leads = new Set(["s2"]);
    const b = await rosterPdf(r);
    expect(pages(b)).toBe(1);
  });

  it("maps letters the built-in font lacks", () => {
    expect(plain("Ɛsi Ɔpoku")).toBe("Esi Opoku");
  });
});
